/**
 * CLAIR MCP Server — stdio transport entry point
 *
 * Use this for local MCP clients (Kilo Code, Claude Desktop, Claude Code)
 * that launch the server as a subprocess via stdio.
 *
 * Usage in mcp_settings.json:
 * {
 *   "mcpServers": {
 *     "clair": {
 *       "command": "node",
 *       "args": ["/path/to/clair-mcp-server/dist/stdio.js"]
 *     }
 *   }
 * }
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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

async function main() {
  const manifest = loadManifest();

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
          path: path.join(PROJECT_ROOT, s.path),
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
        if (skill.mcp_dependencies) {
          for (const dep of skill.mcp_dependencies) {
            mcpDeps.add(dep);
          }
        }
      }

      const result = {
        task_description,
        domains: matchedSkills.map((s) => s.id),
        load_skills: matchedSkills.map((s) => ({
          id: s.id,
          path: path.join(PROJECT_ROOT, s.path),
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

      // Check ML offload registry
      const registry = manifest.ml_offload_registry ?? [];
      const match = registry.find((m) =>
        m.triggers.some((t) => subtask_type.toLowerCase().includes(t.toLowerCase())),
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

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (not stdout — stdout is reserved for MCP protocol)
  process.stderr.write(`CLAIR MCP server started (stdio mode). Manifest: ${manifest.skills.length} skills loaded.\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error starting CLAIR MCP server: ${err}\n`);
  process.exit(1);
});
