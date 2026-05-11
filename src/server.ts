import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { Manifest, Skill } from './types';

const PROJECT_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'manifest.json');

function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest file not found at ${MANIFEST_PATH}`);
  }
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw);
}

function findSkills(manifest: Manifest, query: string): Skill[] {
  const lower = query.toLowerCase();
  return manifest.skills.filter((skill) =>
    skill.triggers.some((t) => lower.includes(t.toLowerCase())),
  );
}

function buildServer(manifest: Manifest) {
  const server = new McpServer({
    name: 'clair',
    version: '1.0.0',
  });

  // Tool: clair_route
  // When task_description is provided, routes the task and returns matched skills.
  // When task_description is omitted, lists all skills (replaces the former clair_list_skills tool).
  const RouteInput = z.object({
    task_description: z.string().optional().describe('Natural language description of the task to route. Omit to list all available skills.'),
    prefer_ml_offload: z.boolean().optional().describe('Whether to aggressively route to ML backends (default: true)'),
  });

  server.registerTool(
    'clair_route',
    {
      title: 'CLAIR router',
      description:
        'Classifies a task and returns the minimal set of skills to load, plus estimated token savings. ' +
        'Call this BEFORE loading skill documents to determine which ones are relevant. ' +
        'Returns load_skills (skill files to attach to context) and load_tools (MCP tools needed). ' +
        'If task_description is omitted, returns all available skills (equivalent to the former clair_list_skills).',
      inputSchema: RouteInput,
    },
    async (input: unknown) => {
      const { task_description } = RouteInput.parse(input);

      // No task_description → list all skills (replaces clair_list_skills)
      if (!task_description) {
        const skillsSummary = manifest.skills.map((s) => ({
          id: s.id,
          path: s.path,
          token_cost: s.token_cost,
          triggers: s.triggers,
          parent: s.parent ?? null,
          children: s.children ?? [],
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(skillsSummary, null, 2) }],
        };
      }

      const matchedSkills = findSkills(manifest, task_description);

      const ROUTER_TOKEN_COST = 280;
      const matchedTokenCost = matchedSkills.reduce((sum, s) => sum + s.token_cost, 0);
      const fullTokenCost = manifest.skills.reduce((sum, s) => sum + s.token_cost, 0);
      const clairCost = ROUTER_TOKEN_COST + matchedTokenCost;
      const estimatedTokensSaved = Math.max(fullTokenCost - clairCost, 0);

      // Collect MCP dependencies from matched skills
      const mcpDeps = new Set<string>();
      for (const skill of matchedSkills) {
        if ((skill as any).mcp_dependencies) {
          for (const dep of (skill as any).mcp_dependencies) {
            mcpDeps.add(dep);
          }
        }
      }

      const result = {
        task_description,
        domains: matchedSkills.map((s) => s.id),
        load_skills: matchedSkills.map((s) => ({
          id: s.id,
          path: s.path,
          token_cost: s.token_cost,
          triggers: s.triggers,
          parent: s.parent ?? null,
        })),
        load_tools: Array.from(mcpDeps).map((dep) => ({
          id: dep,
          reason: `Required by matched skill(s)`,
        })),
        ml_candidates: [],
        estimated_tokens_saved: estimatedTokensSaved,
        full_load_cost: fullTokenCost,
        clair_cost: clairCost,
        routing_confidence:
          matchedSkills.length > 0
            ? Math.min(0.7 + matchedSkills.length * 0.05, 0.99)
            : 0.3,
      };

      const json = JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text', text: json }],
      };
    },
  );

  // Tool: clair_offload (stub — returns fallback_to_llm: true for now)
  const OffloadInput = z.object({
    subtask_type: z.string().describe('Type of subtask to offload (e.g. sentiment_classification)'),
    data: z.unknown().describe('Input data for the ML backend'),
    backend_hint: z.string().optional().describe('Optional specific backend override'),
  });

  server.registerTool(
    'clair_offload',
    {
      title: 'CLAIR ML offload',
      description:
        'Routes a repetitive subtask to an ML backend instead of the LLM. ' +
        'Returns fallback_to_llm: true if no backend is available for the subtask type.',
      inputSchema: OffloadInput,
    },
    async (input: unknown) => {
      const { subtask_type } = OffloadInput.parse(input);

      const registry = (manifest as any).ml_offload_registry ?? [];
      const match = registry.find((m: any) =>
        m.triggers.some((t: string) => subtask_type.toLowerCase().includes(t.toLowerCase())),
      );

      const result = match
        ? {
            subtask_type,
            result: null,
            backend_used: match.backend,
            latency_ms: match.latency_ms,
            confidence: match.accuracy,
            fallback_to_llm: false,
            note: `ML backend '${match.backend}' matched. Implement backend call to get actual result.`,
          }
        : {
            subtask_type,
            result: null,
            backend_used: null,
            latency_ms: 0,
            confidence: null,
            fallback_to_llm: true,
            note: `No ML backend registered for '${subtask_type}'. Proceed with LLM.`,
          };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

async function main() {
  const manifest = loadManifest();

  const app = express();
  app.use(express.json());

  // Health check endpoint for Railway / load balancers (must be registered first)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', server: 'clair-mcp-server', version: '1.0.0' });
  });

  // Shared transport handler for GET (SSE) and POST (JSON-RPC)
  const handleMcp = async (req: Request, res: Response) => {
    const server = buildServer(manifest);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  };

  // MCP endpoint — serve at both /mcp and / so Glama inspector works
  // regardless of whether the user appends /mcp to the URL or not
  app.get('/mcp', handleMcp);
  app.post('/mcp', handleMcp);
  app.delete('/mcp', handleMcp);
  app.get('/', handleMcp);
  app.post('/', handleMcp);
  app.delete('/', handleMcp);

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';

  app.listen(port, host, () => {
    console.log(
      `CLAIR MCP server listening on http://${host}:${port}/mcp (stateless, JSON mode)`,
    );
  });
}

main().catch((err) => {
  console.error('Fatal error starting CLAIR MCP server:', err);
  process.exit(1);
});

