import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import SkillCapsuleRuntime, { formatRuntimeError } from './runtime';
import { collectRuntimeDiagnostics } from './bootstrap';

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = process.env.SKILLCAP_CONFIG_PATH
  ? path.resolve(process.env.SKILLCAP_CONFIG_PATH)
  : path.join(PROJECT_ROOT, '.skillcapsule', 'skillcapsule.config.json');

const TaskSchema = z.object({
  description: z.string(),
  budget: z.number().int().positive().optional(),
  task_type: z.string().optional(),
  allowed_paths: z.array(z.string()).optional(),
  readonly_paths: z.array(z.string()).optional(),
  changed_files: z.array(z.string()).optional(),
  remote: z.string().optional(),
  branch: z.string().optional(),
  intents: z.array(z.string()).optional(),
  run_id: z.string().optional(),
  parent_artifact_id: z.string().optional(),
});

const ComposeInputSchema = z.object({
  task: z.union([z.string(), TaskSchema]),
  budget: z.number().int().positive().optional(),
});

const ActivateInputSchema = z.object({
  atom_id: z.string(),
  task: z.union([z.string(), TaskSchema]).optional(),
});

const OutcomeInputSchema = z.object({
  outcome_file: z.string(),
});

const PatchInputSchema = z.object({
  patch_file: z.string(),
});

const ArtifactListInputSchema = z.object({
  kind: z.enum(['compose', 'prepare', 'verify']).optional(),
  run_id: z.string().optional(),
  parent_artifact_id: z.string().optional(),
  atom_id: z.string().optional(),
  status: z.string().optional(),
  task_type: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const ArtifactGetInputSchema = z.object({
  artifact_id_or_path: z.string(),
});

const ArtifactResumeInputSchema = z.object({
  artifact_id_or_path: z.string(),
});

const ArtifactLatestInputSchema = z.object({
  kind: z.enum(['compose', 'prepare', 'verify']).optional(),
  run_id: z.string().optional(),
  parent_artifact_id: z.string().optional(),
  atom_id: z.string().optional(),
  status: z.string().optional(),
  task_type: z.string().optional(),
  success_only: z.boolean().optional(),
  failed_only: z.boolean().optional(),
});

const ArtifactLineageInputSchema = z.object({
  run_id: z.string(),
});

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function safeToolResult(operation: () => Promise<unknown>) {
  try {
    const payload = await operation();
    return textResult({ ok: true, data: payload });
  } catch (error) {
    return textResult(formatRuntimeError(error));
  }
}

export function buildMcpServer(): McpServer {
  const runtime = new SkillCapsuleRuntime(CONFIG_PATH);
  const server = new McpServer({
    name: 'skill-capsule',
    version: '1.0.0',
  });

  server.registerTool(
    'skillcap_doctor',
    {
      title: 'Skill Capsule doctor',
      description: 'Run non-throwing deployment diagnostics across config, registry, filesystem, and hook runner state.',
      inputSchema: z.object({}) as any,
    },
    async () => {
      return safeToolResult(async () => collectRuntimeDiagnostics(CONFIG_PATH));
    },
  );

  server.registerTool(
    'skillcap_compose',
    {
      title: 'Skill Capsule compose',
      description:
        'Classify a task, match capsules and atoms, plan hooks, run before_render hooks, and return a compact LLM-ready capsule.',
      inputSchema: ComposeInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { task, budget } = ComposeInputSchema.parse(input);
        return runtime.compose(task, budget);
      });
    },
  );

  server.registerTool(
    'skillcap_prepare',
    {
      title: 'Skill Capsule prepare',
      description: 'Run before_render and before_action hooks for one atom and return a readiness receipt.',
      inputSchema: ActivateInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { atom_id, task } = ActivateInputSchema.parse(input);
        return runtime.prepare(atom_id, task);
      });
    },
  );

  server.registerTool(
    'skillcap_activate',
    {
      title: 'Skill Capsule activate',
      description: 'Render a single atom with its pre-render hook plan.',
      inputSchema: ActivateInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { atom_id, task } = ActivateInputSchema.parse(input);
        return runtime.activate(atom_id, task);
      });
    },
  );

  server.registerTool(
    'skillcap_verify',
    {
      title: 'Skill Capsule verify',
      description: 'Run registered after_action hooks for one atom.',
      inputSchema: ActivateInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { atom_id, task } = ActivateInputSchema.parse(input);
        return runtime.verify(atom_id, task);
      });
    },
  );

  server.registerTool(
    'skillcap_record_outcome',
    {
      title: 'Skill Capsule outcome record',
      description: 'Store a structured outcome file under .skillcapsule/outcomes.',
      inputSchema: OutcomeInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { outcome_file } = OutcomeInputSchema.parse(input);
        const result = await runtime.recordOutcome(outcome_file);
        return { recorded_to: result };
      });
    },
  );

  server.registerTool(
    'skillcap_list_artifacts',
    {
      title: 'Skill Capsule list artifacts',
      description: 'List recent compose, prepare, or verify artifacts from the compiled artifact index, with optional filters.',
      inputSchema: ArtifactListInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { kind, run_id, parent_artifact_id, atom_id, status, task_type, limit } = ArtifactListInputSchema.parse(input);
        return runtime.listArtifacts({
          kind,
          runId: run_id,
          parentArtifactId: parent_artifact_id,
          atomId: atom_id,
          status,
          taskType: task_type,
          limit,
        });
      });
    },
  );

  server.registerTool(
    'skillcap_get_artifact',
    {
      title: 'Skill Capsule get artifact',
      description: 'Fetch one compiled artifact by artifact ID or artifact file path.',
      inputSchema: ArtifactGetInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { artifact_id_or_path } = ArtifactGetInputSchema.parse(input);
        return runtime.getArtifact(artifact_id_or_path);
      });
    },
  );

  server.registerTool(
    'skillcap_resume_from_artifact',
    {
      title: 'Skill Capsule resume from artifact',
      description: 'Return the recommended next action and task metadata to continue from an artifact.',
      inputSchema: ArtifactResumeInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { artifact_id_or_path } = ArtifactResumeInputSchema.parse(input);
        return runtime.resumeFromArtifact(artifact_id_or_path);
      });
    },
  );

  server.registerTool(
    'skillcap_get_latest_artifact',
    {
      title: 'Skill Capsule get latest artifact',
      description:
        'Fetch the most recent compiled artifact matching the supplied filters, optionally restricted to successful receipts.',
      inputSchema: ArtifactLatestInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { kind, run_id, parent_artifact_id, atom_id, status, task_type, success_only, failed_only } = ArtifactLatestInputSchema.parse(input);
        const query = {
          kind,
          runId: run_id,
          parentArtifactId: parent_artifact_id,
          atomId: atom_id,
          status,
          taskType: task_type,
        };
        return success_only
          ? runtime.getLatestSuccessfulArtifact(query)
          : failed_only
            ? runtime.getLatestFailedArtifact(query)
            : runtime.getLatestArtifact(query);
      });
    },
  );

  server.registerTool(
    'skillcap_summarize_artifacts',
    {
      title: 'Skill Capsule summarize artifacts',
      description: 'Summarize compiled artifacts by kind, status, and task type, with optional filters.',
      inputSchema: ArtifactLatestInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { kind, run_id, parent_artifact_id, atom_id, status, task_type } = ArtifactLatestInputSchema.parse(input);
        return runtime.summarizeArtifacts({
          kind,
          runId: run_id,
          parentArtifactId: parent_artifact_id,
          atomId: atom_id,
          status,
          taskType: task_type,
        });
      });
    },
  );

  server.registerTool(
    'skillcap_get_artifact_lineage',
    {
      title: 'Skill Capsule get artifact lineage',
      description: 'Fetch all compiled artifacts associated with one execution run ID.',
      inputSchema: ArtifactLineageInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { run_id } = ArtifactLineageInputSchema.parse(input);
        return runtime.getArtifactLineage(run_id);
      });
    },
  );

  server.registerTool(
    'skillcap_validate_patch',
    {
      title: 'Skill Capsule validate patch',
      description: 'Validate a structured patch proposal against atom safety rules.',
      inputSchema: PatchInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { patch_file } = PatchInputSchema.parse(input);
        return runtime.validatePatch(patch_file);
      });
    },
  );

  server.registerTool(
    'skillcap_apply_patch',
    {
      title: 'Skill Capsule apply patch',
      description: 'Apply a validated patch proposal through the governed runtime patch engine.',
      inputSchema: PatchInputSchema as any,
    },
    async (input: unknown) => {
      return safeToolResult(async () => {
        const { patch_file } = PatchInputSchema.parse(input);
        return runtime.applyPatch(patch_file);
      });
    },
  );

  return server;
}
