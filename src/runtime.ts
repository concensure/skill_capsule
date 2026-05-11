import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  ActivationResult,
  ArtifactLineage,
  ArtifactRecord,
  ArtifactPruneResult,
  ArtifactQuery,
  ArtifactResumePlan,
  ArtifactSummary,
  AtomDefinition,
  CapsuleDefinition,
  ComposeResult,
  HookDefinition,
  HookPermission,
  HookPhase,
  PatchApplyResult,
  PatchProposal,
  PatchProposalOp,
  PreparationResult,
  HookRegistry,
  HookResult,
  PatchValidationResult,
  VerificationResult,
  RenderLevel,
  RiskLevel,
  RuntimeErrorEnvelope,
  SkillCapsuleConfig,
  TaskClassification,
  TaskPayload,
} from './types';

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const DEFAULT_ALLOWED_TEMPLATE_KEYS = new Set([
  'TASK',
  'TASK_TYPE',
  'RISK',
  'HOOK_RESULTS',
  'ACTIVATED_ATOMS',
  'ALLOWED_PATHS',
  'READONLY_PATHS',
  'CHANGED_FILES',
  'REMOTE',
  'BRANCH',
  'TRIGGERS',
  'PAIR_COUNT',
]);

const DEFAULT_HOOK_ALLOWED_PREFIXES = {
  read_only: ['git status', 'npm run typecheck', 'npm test', 'node .skillcapsule/hooks/scripts/'],
  read_write: ['node .skillcapsule/hooks/scripts/'],
  restricted_exec: ['git push'],
} as const;

const MINIMAL_HOST_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'ComSpec',
  'TMP',
  'TEMP',
  'HOME',
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'OS',
  'WINDIR',
  'TERM',
] as const;

interface PlannedHook {
  id: string;
  phase: HookPhase;
  atomId: string;
  kind?: string;
  required?: boolean;
  blocksOnFail: boolean;
  requiresUserApproval: boolean;
}

interface AtomSelection {
  atom: AtomDefinition;
  capsuleIds: string[];
  mandatory: boolean;
}

interface HookExecutionSpec {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  windowsVerbatimArguments?: boolean;
}

export class SkillCapsuleRuntimeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, retryable = false, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SkillCapsuleRuntimeError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function formatRuntimeError(error: unknown): RuntimeErrorEnvelope {
  if (error instanceof SkillCapsuleRuntimeError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
      retryable: false,
    },
  };
}

export class SkillCapsuleRuntime {
  readonly configPath: string;
  readonly projectRoot: string;
  readonly capsuleRoot: string;
  readonly config: SkillCapsuleConfig;
  readonly atomsDir: string;
  readonly capsulesDir: string;
  readonly hooksDir: string;
  readonly outcomesDir: string;
  readonly patchesDir: string;
  readonly compiledDir: string;
  readonly artifactIndexPath: string;
  readonly logsDir: string;

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
    this.projectRoot = path.dirname(path.dirname(this.configPath));
    this.capsuleRoot = path.dirname(this.configPath);
    this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as SkillCapsuleConfig;
    this.atomsDir = path.resolve(this.projectRoot, this.config.atom_dir ?? '.skillcapsule/atoms');
    this.capsulesDir = path.resolve(this.projectRoot, this.config.capsule_dir ?? '.skillcapsule/capsules');
    this.hooksDir = path.resolve(this.projectRoot, this.config.hook_dir ?? '.skillcapsule/hooks');
    this.outcomesDir = path.resolve(this.projectRoot, this.config.outcome_dir ?? '.skillcapsule/outcomes');
    this.patchesDir = path.resolve(this.projectRoot, this.config.patch_dir ?? '.skillcapsule/patches');
    this.compiledDir = path.resolve(this.projectRoot, '.skillcapsule/compiled');
    this.artifactIndexPath = path.join(this.compiledDir, 'artifacts.index.json');
    this.logsDir = path.resolve(this.projectRoot, this.config.observability?.log_dir ?? '.skillcapsule/logs');
  }

  listAtoms(): AtomDefinition[] {
    return this.readJsonDirectory<AtomDefinition>(this.atomsDir);
  }

  listCapsules(): CapsuleDefinition[] {
    return this.readJsonDirectory<CapsuleDefinition>(this.capsulesDir);
  }

  listHooks(): HookDefinition[] {
    const registryPath = path.join(this.hooksDir, 'hooks.registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as HookRegistry;
    return registry.hooks;
  }

  listArtifacts(query: ArtifactQuery = {}): ArtifactRecord[] {
    return this.filterArtifacts(query).slice(0, query.limit ?? 20);
  }

  getLatestArtifact(query: ArtifactQuery = {}): ArtifactRecord | null {
    return this.filterArtifacts({ ...query, limit: undefined })[0] ?? null;
  }

  getLatestSuccessfulArtifact(query: ArtifactQuery = {}): ArtifactRecord | null {
    const successStatuses = this.resolveSuccessfulStatuses(query.kind);
    const statusFiltered = query.status
      ? successStatuses.includes(query.status)
        ? [query.status]
        : []
      : successStatuses;
    if (statusFiltered.length === 0) {
      return null;
    }
    const filtered = this.filterArtifacts({ ...query, limit: undefined }).filter((record) =>
      statusFiltered.includes(record.status ?? ''),
    );
    return filtered[0] ?? null;
  }

  summarizeArtifacts(query: Omit<ArtifactQuery, 'limit'> = {}): ArtifactSummary {
    const records = this.filterArtifacts({ ...query, limit: undefined });
    const runIds = new Set(records.map((record) => record.runId).filter((value): value is string => Boolean(value)));
    const summary: ArtifactSummary = {
      total: records.length,
      runIds: runIds.size,
      byKind: {},
      byStatus: {},
      byTaskType: {},
      latestCreatedAt: records[0]?.createdAt,
    };

    for (const record of records) {
      summary.byKind[record.kind] = (summary.byKind[record.kind] ?? 0) + 1;
      if (record.status) {
        summary.byStatus[record.status] = (summary.byStatus[record.status] ?? 0) + 1;
      }
      if (record.taskType) {
        summary.byTaskType[record.taskType] = (summary.byTaskType[record.taskType] ?? 0) + 1;
      }
    }

    return summary;
  }

  getArtifactLineage(runId: string): ArtifactLineage {
    const artifacts = this.filterArtifacts({ runId, limit: undefined });
    if (artifacts.length === 0) {
      throw new SkillCapsuleRuntimeError('ARTIFACT_LINEAGE_NOT_FOUND', `Artifact lineage not found for run: ${runId}`, false, { runId });
    }
    const roots: string[] = [];
    const childrenByParent: Record<string, string[]> = {};
    for (const artifact of [...artifacts].reverse()) {
      if (!artifact.parentArtifactId) {
        roots.push(artifact.id);
        continue;
      }
      childrenByParent[artifact.parentArtifactId] = childrenByParent[artifact.parentArtifactId] ?? [];
      childrenByParent[artifact.parentArtifactId].push(artifact.id);
    }
    return { runId, artifacts, roots, childrenByParent };
  }

  resumeFromArtifact(idOrPath: string): ArtifactResumePlan {
    const artifact = this.getArtifactRecord(idOrPath);
    const payload = this.getArtifact(idOrPath);
    const task = this.extractTaskFromArtifactPayload(payload, artifact);

    if (artifact.kind === 'compose') {
      return {
        sourceArtifactId: artifact.id,
        runId: artifact.runId,
        recommendedAction: 'prepare',
        task,
      };
    }

    if (artifact.kind === 'prepare') {
      return {
        sourceArtifactId: artifact.id,
        runId: artifact.runId,
        recommendedAction: artifact.status === 'BLOCKED' ? 'prepare' : 'verify',
        atomId: artifact.atomId,
        task,
      };
    }

    return {
      sourceArtifactId: artifact.id,
      runId: artifact.runId,
      recommendedAction: 'verify',
      atomId: artifact.atomId,
      task,
    };
  }

  getLatestFailedArtifact(query: ArtifactQuery = {}): ArtifactRecord | null {
    const failureStatuses = this.resolveFailureStatuses(query.kind);
    const filtered = this.filterArtifacts({ ...query, limit: undefined }).filter((record) =>
      failureStatuses.includes(record.status ?? ''),
    );
    return filtered[0] ?? null;
  }

  getArtifact(idOrPath: string): Record<string, unknown> {
    const records = this.readArtifactIndex();
    const record = records.find((item) => item.id === idOrPath || item.path === path.resolve(idOrPath));
    const resolvedPath = record?.path ?? path.resolve(idOrPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new SkillCapsuleRuntimeError('ARTIFACT_NOT_FOUND', `Artifact not found: ${idOrPath}`, false, { idOrPath });
    }
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as Record<string, unknown>;
  }

  pruneArtifacts(): ArtifactPruneResult {
    const records = this.readArtifactIndex();
    const { kept, removed } = this.computePrunedArtifactSets(records);
    for (const record of removed) {
      if (fs.existsSync(record.path)) {
        fs.unlinkSync(record.path);
      }
    }
    this.writeArtifactIndex(kept);
    return { removed, kept: kept.length };
  }

  classifyTask(taskInput: string | TaskPayload): TaskClassification {
    const task = this.normalizeTask(taskInput);
    const text = task.description.toLowerCase();
    const tags = new Set<string>();
    const intents = new Set<string>(task.intents ?? []);

    let taskType = task.task_type ?? 'general';
    let risk: RiskLevel = 'low';

    if (/(github|git push|publish|upload|release|deploy)/.test(text)) {
      taskType = 'publish';
      risk = 'high';
      tags.add('github');
      tags.add('publish');
    }
    if (/(edit|fix|change|update|modify|bug)/.test(text)) {
      taskType = taskType === 'publish' ? taskType : 'coding';
      risk = risk === 'high' ? risk : 'medium';
      tags.add('coding');
    }
    if (/(refactor|restructure|rename|move)/.test(text)) {
      taskType = 'refactor';
      risk = 'high';
      tags.add('refactor');
    }
    if (/(meta|capsule|hook|registry|patch model|outcome)/.test(text)) {
      taskType = taskType === 'general' ? 'meta_analysis' : taskType;
      tags.add('meta');
    }
    if (/(api key|secret|token|credential|password)/.test(text)) {
      risk = 'critical';
      tags.add('secret-sensitive');
    }

    const intentPatterns: Array<[RegExp, string]> = [
      [/\b(do not push|don't push|dont push|no push|dry run)\b/, 'no_push'],
      [/\b(skip checks|no safety|do not run safety|without tests)\b/, 'no_safety_checks'],
      [/\b(read only|no file write|do not edit)\b/, 'no_file_write'],
      [/\b(no meta evolution|disable evolution)\b/, 'no_meta_evolution'],
    ];
    for (const [pattern, intent] of intentPatterns) {
      if (pattern.test(text)) {
        intents.add(intent);
      }
    }

    for (const word of ['github', 'push', 'upload', 'typecheck', 'test', 'diff', 'scope']) {
      if (text.includes(word)) {
        tags.add(word);
      }
    }

    return {
      raw: task.description,
      taskType,
      risk,
      intents: Array.from(intents),
      tags: Array.from(tags),
    };
  }

  match(taskInput: string | TaskPayload) {
    const task = this.normalizeTask(taskInput);
    const classification = this.classifyTask(task);
    const { selections, selectedCapsules } = this.selectAtomsForTask(task, classification);

    return {
      task,
      classification,
      capsules: selectedCapsules.map((capsule) => capsule.id),
      atoms: selections.map((selection) => selection.atom.id),
    };
  }

  async compose(taskInput: string | TaskPayload, requestedBudget?: number): Promise<ComposeResult> {
    return this.runAudited('compose', { requestedBudget }, async () => {
      const task = this.normalizeTask(taskInput);
      const runId = task.run_id ?? this.buildRunId();
      const parentArtifactId = this.resolveParentArtifactId(runId, task.parent_artifact_id);
      const classification = this.classifyTask(task);
      const { selections, selectedCapsules } = this.selectAtomsForTask(task, classification);
      const hookPlan = this.planHooks(selections.map((selection) => selection.atom));
      const beforeRenderHooks = hookPlan.before_render ?? [];
      const beforeRenderResults = await this.runHooks(beforeRenderHooks, task, classification);
      const hookResultMap = new Map<string, HookResult>(beforeRenderResults.map((result) => [result.id, result]));
      const budget = this.resolveBudget(requestedBudget ?? task.budget, selectedCapsules);
      const renderPlan = this.buildRenderPlan(selections, classification, budget, hookResultMap);
      const compiledCapsule = this.compileCapsule(task, classification, renderPlan, hookResultMap);

      const result: ComposeResult = {
        runId,
        task,
        classification,
        selectedCapsules: selectedCapsules.map((capsule) => capsule.id),
        atoms: renderPlan.map((item) => item.atom.id),
        renderPlan: renderPlan.map((item) => ({
          atomId: item.atom.id,
          capsuleIds: item.capsuleIds,
          renderLevel: item.renderLevel,
          tokenCost: item.atom.token_estimate[item.renderLevel] ?? 0,
        })),
        hookPlan: this.hookPlanToIds(hookPlan),
        hookResults: beforeRenderResults.length > 0 ? { before_render: beforeRenderResults } : {},
        receipt: {
          taskType: classification.taskType,
          risk: classification.risk,
          intents: classification.intents,
          capsules: selectedCapsules.map((capsule) => capsule.id),
          atoms: renderPlan.map((item) => item.atom.id),
          hooks: this.hookPlanToIds(hookPlan),
        },
        compiledCapsule,
      };

      result.artifactPath = this.writeCompiledArtifact(result, runId, parentArtifactId);
      return result;
    });
  }

  async activate(atomId: string, taskInput?: string | TaskPayload): Promise<ActivationResult> {
    return this.runAudited('activate', { atomId }, async () => {
      const atom = this.getAtom(atomId);
      const task = this.normalizeTask(taskInput ?? { description: `Activate ${atomId}` });
      const runId = task.run_id ?? this.buildRunId();
      const classification = this.classifyTask(task);
      const hookPlan = this.planHooks([atom]);
      const beforeRenderResults = await this.runHooks(hookPlan.before_render ?? [], task, classification);
      const hookResultMap = this.collectHookResultMap(beforeRenderResults);
      const renderLevel = this.selectRenderLevel(atom, classification, true, hookResultMap);
      const compiledCapsule = this.compileCapsule(
        task,
        classification,
        [{ atom, capsuleIds: [], renderLevel }],
        hookResultMap,
      );

      return {
        runId,
        atomId,
        renderLevel,
        hookPlan: this.hookPlanToIds(hookPlan),
        hookResults: beforeRenderResults.length > 0 ? { before_render: beforeRenderResults } : {},
        compiledCapsule,
      };
    });
  }

  async prepare(atomId: string, taskInput?: string | TaskPayload): Promise<PreparationResult> {
    return this.runAudited('prepare', { atomId }, async () => {
      const atom = this.getAtom(atomId);
      const task = this.normalizeTask(taskInput ?? { description: `Prepare ${atomId}` });
      const runId = task.run_id ?? this.buildRunId();
      const parentArtifactId = this.resolveParentArtifactId(runId, task.parent_artifact_id);
      const classification = this.classifyTask(task);
      const hookPlan = this.planHooks([atom]);
      const beforeRenderResults = await this.runHooks(hookPlan.before_render ?? [], task, classification);
      const beforeActionResults = await this.runHooks(hookPlan.before_action ?? [], task, classification);
      const allResults = [...beforeRenderResults, ...beforeActionResults];
      const hookResultMap = this.collectHookResultMap(allResults);
      const renderLevel = this.selectRenderLevel(atom, classification, true, hookResultMap);
      const blockingHooks = beforeActionResults
        .filter((result) => result.status === 'FAIL' || result.blocked)
        .map((result) => result.id);

      const result: PreparationResult = {
        runId,
        atomId,
        renderLevel,
        hookPlan: this.hookPlanToIds(hookPlan),
        hookResults: {
          ...(beforeRenderResults.length > 0 ? { before_render: beforeRenderResults } : {}),
          ...(beforeActionResults.length > 0 ? { before_action: beforeActionResults } : {}),
        },
        receipt: {
          status: blockingHooks.length > 0 ? 'BLOCKED' : 'READY',
          blockingHooks,
          executedPhases: [
            ...(beforeRenderResults.length > 0 ? ['before_render' as const] : []),
            ...(beforeActionResults.length > 0 ? ['before_action' as const] : []),
          ],
        },
        compiledCapsule: this.compileCapsule(
          task,
          classification,
          [{ atom, capsuleIds: [], renderLevel }],
          hookResultMap,
        ),
      };

      result.artifactPath = this.writePreparationArtifact(result, task, classification, runId, parentArtifactId);
      return result;
    });
  }

  async verify(atomId: string, taskInput?: string | TaskPayload): Promise<VerificationResult> {
    return this.runAudited('verify', { atomId }, async () => {
      const atom = this.getAtom(atomId);
      const task = this.normalizeTask(taskInput ?? { description: `Verify ${atomId}` });
      const runId = task.run_id ?? this.buildRunId();
      const parentArtifactId = this.resolveParentArtifactId(runId, task.parent_artifact_id);
      const classification = this.classifyTask(task);
      const hookPlan = this.planHooks([atom]);
      const afterActionResults = await this.runHooks(hookPlan.after_action ?? [], task, classification);
      const blockingHooks = afterActionResults
        .filter((result) => result.status === 'FAIL' || result.blocked)
        .map((result) => result.id);
      const result: VerificationResult = {
        runId,
        atomId,
        hookPlan: this.hookPlanToIds(hookPlan),
        hookResults: afterActionResults.length > 0 ? { after_action: afterActionResults } : {},
        receipt: {
          status: blockingHooks.length > 0 ? 'FAIL' : 'PASS',
          blockingHooks,
          executedPhases: afterActionResults.length > 0 ? ['after_action'] : [],
        },
      };
      result.artifactPath = this.writeVerificationArtifact(result, task, classification, runId, parentArtifactId);
      return result;
    });
  }

  async recordOutcome(outcomePath: string): Promise<string> {
    return this.runAudited('record_outcome', { outcomePath }, async () => {
      const inputPath = path.resolve(outcomePath);
      const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as Record<string, unknown>;
      fs.mkdirSync(this.outcomesDir, { recursive: true });
      const outputPath = path.join(this.outcomesDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      this.writeJsonAtomic(outputPath, data);
      return outputPath;
    });
  }

  validatePatch(patchPath: string): PatchValidationResult {
    const patch = this.readPatch(patchPath);
    const atom = this.getAtom(patch.target_atom);
    const validation: PatchValidationResult = { status: 'PASS', violations: [] };
    const allowedOps = new Set([
      'replace_render',
      'add_trigger_keyword',
      'remove_trigger_keyword',
      'tighten_activation',
      'add_example',
      'deprecate_example',
      'append_evidence',
      'change_status',
    ]);

    if (patch.base_version !== atom.version) {
      validation.violations.push(
        `Version mismatch: patch base ${patch.base_version} does not match ${patch.target_atom}@${atom.version}.`,
      );
    }

    for (const op of patch.ops ?? []) {
      const opName = String(op.op ?? '');
      if (!allowedOps.has(opName)) {
        validation.violations.push(`Operation not allowed without review: ${opName}`);
      }
      if (String(op.field ?? '').startsWith('hooks')) {
        validation.violations.push('Hook modifications require human approval.');
      }
      if (opName === 'add_trigger_keyword' && typeof op.value === 'string') {
        const keyword = op.value.toLowerCase();
        const exists = (atom.triggers.keywords ?? []).some((item) => item.toLowerCase() === keyword);
        if (exists) {
          validation.violations.push(`Trigger keyword already exists: ${op.value}`);
        }
      }
      if (opName === 'remove_trigger_keyword' && typeof op.value === 'string') {
        const keyword = op.value.toLowerCase();
        const remaining = (atom.triggers.keywords ?? []).filter((item) => item.toLowerCase() !== keyword);
        if (remaining.length === 0) {
          validation.violations.push('Cannot remove the last trigger keyword from an atom.');
        }
      }
      if (opName === 'replace_render' && typeof op.value === 'string' && op.value.length > 800) {
        validation.violations.push('Replacement render is too large for the token budget.');
      }
      if (opName === 'replace_render' && op.level && !['S', 'O', 'X'].includes(String(op.level))) {
        validation.violations.push(`Invalid render level: ${String(op.level)}`);
      }
      if (opName === 'tighten_activation' && String(op.field ?? '') !== 'activation.risk_min') {
        validation.violations.push('tighten_activation currently only supports activation.risk_min.');
      }
      if (
        opName === 'tighten_activation' &&
        typeof op.value === 'string' &&
        !['low', 'medium', 'high', 'critical'].includes(op.value)
      ) {
        validation.violations.push(`Invalid risk floor: ${op.value}`);
      }
      if (opName === 'change_status' && typeof op.value === 'string' && !['draft', 'candidate', 'active', 'retired', 'experimental'].includes(op.value)) {
        validation.violations.push(`Invalid status: ${op.value}`);
      }
    }

    if (validation.violations.length > 0) {
      validation.status = 'FAIL';
    }

    return validation;
  }

  applyPatch(patchPath: string): PatchApplyResult {
    const resolvedPatchPath = path.resolve(patchPath);
    const validation = this.validatePatch(resolvedPatchPath);
    if (validation.status === 'FAIL') {
      throw new SkillCapsuleRuntimeError(
        'PATCH_VALIDATION_FAILED',
        `Patch validation failed: ${validation.violations.join(' | ')}`,
        false,
        { patchPath: resolvedPatchPath, violations: validation.violations },
      );
    }

    const patch = this.readPatch(resolvedPatchPath);
    const atomPath = path.join(this.atomsDir, `${patch.target_atom}.json`);
    const atom = this.getAtom(patch.target_atom);
    const nextAtom = JSON.parse(JSON.stringify(atom)) as AtomDefinition;

    for (const op of patch.ops) {
      this.applyPatchOp(nextAtom, op);
    }

    nextAtom.version = this.bumpPatchVersion(nextAtom.version);
    this.writeTextAtomic(atomPath, `${JSON.stringify(nextAtom, null, 2)}\n`);

    const archivedPatchPath = this.archivePatch(resolvedPatchPath, 'accepted');
    return {
      status: 'APPLIED',
      targetAtom: nextAtom.id,
      atomPath,
      patchPath: resolvedPatchPath,
      archivedPatchPath,
      newVersion: nextAtom.version,
      appliedOps: patch.ops.map((op) => op.op),
    };
  }

  private normalizeTask(taskInput: string | TaskPayload): TaskPayload {
    if (typeof taskInput !== 'string') {
      return {
        description: taskInput.description,
        budget: taskInput.budget,
        task_type: taskInput.task_type,
        allowed_paths: taskInput.allowed_paths ?? ['*'],
        readonly_paths: taskInput.readonly_paths ?? [],
        changed_files: taskInput.changed_files ?? [],
        remote: taskInput.remote ?? 'origin',
        branch: taskInput.branch ?? 'main',
        intents: taskInput.intents ?? [],
        run_id: taskInput.run_id,
        parent_artifact_id: taskInput.parent_artifact_id,
      };
    }

    const potentialPath = path.resolve(taskInput);
    if (taskInput.endsWith('.json') && fs.existsSync(potentialPath)) {
      return this.normalizeTask(JSON.parse(fs.readFileSync(potentialPath, 'utf-8')) as TaskPayload);
    }

    return {
      description: taskInput,
      allowed_paths: ['*'],
      readonly_paths: [],
      changed_files: [],
      remote: 'origin',
      branch: 'main',
      intents: [],
      parent_artifact_id: undefined,
    };
  }

  private readJsonDirectory<T>(directory: string): T[] {
    if (!fs.existsSync(directory)) {
      return [];
    }

    return fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8')) as T);
  }

  private readPatch(patchPath: string): PatchProposal {
    return JSON.parse(fs.readFileSync(path.resolve(patchPath), 'utf-8')) as PatchProposal;
  }

  private collectHookResultMap(results: HookResult[]): Map<string, HookResult> {
    return new Map(results.map((result) => [result.id, result]));
  }

  private getAtom(atomId: string): AtomDefinition {
    const atom = this.listAtoms().find((item) => item.id === atomId);
    if (!atom) {
      throw new SkillCapsuleRuntimeError('ATOM_NOT_FOUND', `Atom definition not found: ${atomId}`, false, { atomId });
    }
    return atom;
  }

  private applyPatchOp(atom: AtomDefinition, op: PatchProposalOp): void {
    switch (op.op) {
      case 'replace_render': {
        const level = (op.level ?? op.field ?? 'O') as RenderLevel;
        if (!atom.render[level]) {
          throw new Error(`Render level does not exist on atom ${atom.id}: ${level}`);
        }
        atom.render[level] = String(op.value ?? '');
        return;
      }
      case 'add_trigger_keyword': {
        const keywords = atom.triggers.keywords ?? [];
        atom.triggers.keywords = [...keywords, String(op.value)];
        return;
      }
      case 'remove_trigger_keyword': {
        atom.triggers.keywords = (atom.triggers.keywords ?? []).filter((item) => item !== String(op.value));
        return;
      }
      case 'tighten_activation': {
        atom.activation = atom.activation ?? {};
        atom.activation.risk_min = String(op.value) as RiskLevel;
        return;
      }
      case 'add_example': {
        const record = atom as AtomDefinition & { examples?: string[] };
        record.examples = [...(record.examples ?? []), String(op.value)];
        return;
      }
      case 'deprecate_example': {
        const record = atom as AtomDefinition & { examples?: string[] };
        record.examples = (record.examples ?? []).filter((item) => item !== String(op.value));
        return;
      }
      case 'append_evidence': {
        const record = atom as AtomDefinition & { evidence?: string[] };
        record.evidence = [...(record.evidence ?? []), String(op.value)];
        return;
      }
      case 'change_status': {
        atom.status = String(op.value);
        return;
      }
      default:
        throw new Error(`Unsupported patch operation during apply: ${op.op}`);
    }
  }

  private selectAtomsForTask(task: TaskPayload, classification: TaskClassification) {
    const atoms = this.listAtoms();
    const capsules = this.listCapsules();
    const matchedAtoms = atoms.filter((atom) => this.atomMatches(atom, classification));
    const matchedIds = new Set(matchedAtoms.map((atom) => atom.id));

    const selectedCapsules = capsules.filter((capsule) => capsule.atoms.some((atomId) => matchedIds.has(atomId)));
    const selectionMap = new Map<string, AtomSelection>();

    for (const capsule of selectedCapsules) {
      for (const atomId of capsule.atoms) {
        const atom = atoms.find((item) => item.id === atomId);
        if (!atom || !this.atomAllowedByIntent(atom, classification)) {
          continue;
        }
        const existing = selectionMap.get(atom.id);
        if (existing) {
          existing.capsuleIds.push(capsule.id);
          existing.mandatory = existing.mandatory || matchedIds.has(atom.id);
          continue;
        }
        selectionMap.set(atom.id, {
          atom,
          capsuleIds: [capsule.id],
          mandatory: matchedIds.has(atom.id),
        });
      }
    }

    for (const atom of matchedAtoms) {
      if (!selectionMap.has(atom.id)) {
        selectionMap.set(atom.id, { atom, capsuleIds: [], mandatory: true });
      }
    }

    const selections = this.resolveDependencies(Array.from(selectionMap.values()), atoms, classification);
    return { selections, selectedCapsules };
  }

  private atomMatches(atom: AtomDefinition, classification: TaskClassification): boolean {
    if (!this.atomAllowedByIntent(atom, classification)) {
      return false;
    }

    if (atom.id.startsWith('meta.') && this.config.meta_evolution?.hot_path_analysis === false) {
      return classification.taskType === 'meta_analysis';
    }

    const text = classification.raw.toLowerCase();
    const keywords = atom.triggers.keywords ?? [];
    const taskTypes = atom.triggers.task_types ?? [];
    const keywordMatch = keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    const taskTypeMatch = taskTypes.includes(classification.taskType);
    const autoActivate = atom.triggers.auto_activate || atom.activation?.auto_activate;
    const riskSatisfied = this.meetsRiskFloor(atom.activation?.risk_min, classification.risk);

    return riskSatisfied && (keywordMatch || taskTypeMatch || Boolean(autoActivate && taskTypeMatch));
  }

  private atomAllowedByIntent(atom: AtomDefinition, classification: TaskClassification): boolean {
    const blockedBy = atom.triggers.blocked_by_intents ?? [];
    return !blockedBy.some((intent) => classification.intents.includes(intent));
  }

  private resolveDependencies(
    selections: AtomSelection[],
    atoms: AtomDefinition[],
    classification: TaskClassification,
  ): AtomSelection[] {
    const selectionMap = new Map(selections.map((selection) => [selection.atom.id, selection]));
    const queue = [...selections];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      for (const dependencyId of current.atom.dependencies ?? []) {
        if (selectionMap.has(dependencyId)) {
          continue;
        }
        const dependency = atoms.find((atom) => atom.id === dependencyId);
        if (!dependency || !this.atomAllowedByIntent(dependency, classification)) {
          continue;
        }
        const selection: AtomSelection = {
          atom: dependency,
          capsuleIds: [],
          mandatory: true,
        };
        selectionMap.set(dependency.id, selection);
        queue.push(selection);
      }
    }

    const conflicts = new Set<string>();
    for (const selection of selectionMap.values()) {
      for (const conflict of selection.atom.conflicts ?? []) {
        conflicts.add(conflict);
      }
    }

    return Array.from(selectionMap.values()).filter((selection) => !conflicts.has(selection.atom.id));
  }

  private planHooks(atoms: AtomDefinition[]): Record<HookPhase, PlannedHook[]> {
    const registry = new Map(this.listHooks().map((hook) => [hook.id, hook]));
    const plan: Record<HookPhase, PlannedHook[]> = {
      before_render: [],
      before_action: [],
      after_action: [],
      on_failure: [],
      on_patch_proposal: [],
    };
    const seen = new Set<string>();

    for (const atom of atoms) {
      for (const hook of atom.hooks ?? []) {
        const key = `${hook.phase}:${hook.id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        plan[hook.phase].push({
          id: hook.id,
          phase: hook.phase,
          atomId: atom.id,
          kind: hook.kind,
          required: hook.required,
          blocksOnFail: Boolean(hook.blocks_on_fail),
          requiresUserApproval: Boolean(hook.requires_user_approval),
        });
      }
    }

    for (const phase of Object.keys(plan) as HookPhase[]) {
      plan[phase] = this.orderHooksForPhase(plan[phase], registry, phase);
    }

    return plan;
  }

  private orderHooksForPhase(
    hooks: PlannedHook[],
    registry: Map<string, HookDefinition>,
    phase: HookPhase,
  ): PlannedHook[] {
    const plannedById = new Map(hooks.map((hook) => [hook.id, hook]));
    const adjacency = new Map<string, string[]>();
    const indegree = new Map<string, number>();

    for (const hook of hooks) {
      adjacency.set(hook.id, []);
      indegree.set(hook.id, 0);
    }

    for (const hook of hooks) {
      const definition = registry.get(hook.id);
      for (const dependencyId of definition?.depends_on ?? []) {
        if (!plannedById.has(dependencyId)) {
          throw new Error(
            `Hook dependency ${dependencyId} required by ${hook.id} is not present in phase ${phase}.`,
          );
        }
        adjacency.get(dependencyId)?.push(hook.id);
        indegree.set(hook.id, (indegree.get(hook.id) ?? 0) + 1);
      }
    }

    const ordered: PlannedHook[] = [];
    const ready = hooks
      .filter((hook) => (indegree.get(hook.id) ?? 0) === 0)
      .sort((left, right) => left.id.localeCompare(right.id));

    while (ready.length > 0) {
      const next = ready.shift();
      if (!next) {
        continue;
      }
      ordered.push(next);
      for (const dependentId of adjacency.get(next.id) ?? []) {
        const remaining = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) {
          const dependent = plannedById.get(dependentId);
          if (dependent) {
            ready.push(dependent);
            ready.sort((left, right) => left.id.localeCompare(right.id));
          }
        }
      }
    }

    if (ordered.length !== hooks.length) {
      const unresolved = hooks
        .filter((hook) => !ordered.find((orderedHook) => orderedHook.id === hook.id))
        .map((hook) => hook.id);
      throw new Error(`Hook dependency cycle detected in phase ${phase}: ${unresolved.join(', ')}`);
    }

    return ordered;
  }

  private async runHooks(
    hooks: PlannedHook[],
    task: TaskPayload,
    classification: TaskClassification,
  ): Promise<HookResult[]> {
    const registry = new Map(this.listHooks().map((hook) => [hook.id, hook]));
    const results: HookResult[] = [];

    for (const plannedHook of hooks) {
      const definition = registry.get(plannedHook.id);
      if (!definition) {
        results.push(this.makeSyntheticHookResult(plannedHook, 'FAIL', `Hook not registered: ${plannedHook.id}`));
        if (plannedHook.blocksOnFail) {
          break;
        }
        continue;
      }

      if (!definition.phases.includes(plannedHook.phase)) {
        results.push(this.makeSyntheticHookResult(plannedHook, 'FAIL', `Hook phase not allowed: ${plannedHook.phase}`));
        if (plannedHook.blocksOnFail) {
          break;
        }
        continue;
      }

      if (!this.permissionAllowed(definition.permission, plannedHook.phase)) {
        results.push(
          this.makeSyntheticHookResult(
            plannedHook,
            'FAIL',
            `Permission ${definition.permission} is not allowed during ${plannedHook.phase}.`,
            definition,
          ),
        );
        if (plannedHook.blocksOnFail) {
          break;
        }
        continue;
      }

      if (definition.requires_user_approval || plannedHook.requiresUserApproval) {
        results.push(
          this.makeSyntheticHookResult(
            plannedHook,
            'SKIP',
            'Hook requires explicit user approval and was not executed automatically.',
            definition,
          ),
        );
        continue;
      }

      let command: string;
      try {
        command = this.renderHookCommand(definition.command, task, classification, results);
        this.validateHookCommand(command, definition);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push(this.makeSyntheticHookResult(plannedHook, 'FAIL', message, definition));
        if (plannedHook.blocksOnFail) {
          break;
        }
        continue;
      }

      const startedAt = Date.now();
      const execution = await this.executeCommand(
        command,
        definition.timeout_ms,
        this.buildHookEnvironment(task, classification),
        definition.permission,
      );
      const durationMs = Date.now() - startedAt;
      const status =
        execution.error || execution.exitCode !== 0
          ? plannedHook.blocksOnFail || definition.kind === 'verify'
            ? 'FAIL'
            : 'WARN'
          : 'PASS';

      const rawOutput = [execution.stdout, execution.stderr].filter(Boolean).join('\n').trim();
      const summary = this.summariseOutput(rawOutput || execution.error || '', definition);

      results.push({
        id: definition.id,
        status,
        phase: plannedHook.phase,
        kind: definition.kind,
        permission: definition.permission,
        command,
        summary,
        rawOutput,
        exitCode: execution.exitCode,
        durationMs,
        blocked: plannedHook.blocksOnFail && status !== 'PASS',
      });

      if (plannedHook.blocksOnFail && status !== 'PASS') {
        break;
      }
    }

    return results;
  }

  private async executeCommand(
    command: string,
    timeoutMs: number,
    extraEnv: NodeJS.ProcessEnv,
    permission: HookPermission,
  ) {
    return new Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }>((resolve) => {
      let parsed;
      try {
        parsed = this.tokenizeCommand(command);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve({ stdout: '', stderr: '', exitCode: null, error: message });
        return;
      }

      let executionSpec: HookExecutionSpec;
      try {
        executionSpec = this.buildHookExecutionSpec(parsed, extraEnv, permission);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve({ stdout: '', stderr: '', exitCode: null, error: message });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      const child = spawn(executionSpec.file, executionSpec.args, {
        cwd: executionSpec.cwd,
        env: executionSpec.env,
        windowsHide: true,
        shell: false,
        windowsVerbatimArguments: executionSpec.windowsVerbatimArguments,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: null,
          error: error.message,
        });
      });
      child.on('close', (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code,
          error: timedOut
            ? `Command timed out after ${timeoutMs}ms`
            : signal
              ? `Command terminated by signal: ${signal}`
              : undefined,
        });
      });
    });
  }

  private buildHookEnvironment(task: TaskPayload, classification: TaskClassification): NodeJS.ProcessEnv {
    return {
      SC_TASK: task.description,
      SC_TASK_TYPE: classification.taskType,
      SC_RISK: classification.risk,
      SC_ALLOWED_PATHS: (task.allowed_paths ?? ['*']).join(','),
      SC_READONLY_PATHS: (task.readonly_paths ?? []).join(','),
      SC_CHANGED_FILES: (task.changed_files ?? []).join(','),
      SC_REMOTE: task.remote ?? 'origin',
      SC_BRANCH: task.branch ?? 'main',
    };
  }

  private buildHookProcessEnvironment(extraEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of MINIMAL_HOST_ENV_KEYS) {
      const value = process.env[key];
      if (value) {
        env[key] = value;
      }
    }

    const allowedPassthrough = new Set(this.config.security?.hook_policy?.allowed_env_passthrough ?? []);
    for (const key of allowedPassthrough) {
      const value = process.env[key];
      if (value) {
        env[key] = value;
      }
    }

    return {
      ...env,
      ...extraEnv,
    };
  }

  private buildHookExecutionSpec(
    parsed: { file: string; args: string[] },
    extraEnv: NodeJS.ProcessEnv,
    permission: HookPermission,
  ): HookExecutionSpec {
    if (!this.shouldUseContainerRunner()) {
      return {
        file: parsed.file,
        args: parsed.args,
        env: this.buildHookProcessEnvironment(extraEnv),
        cwd: this.projectRoot,
      };
    }

    const executable = this.resolveHookRunnerExecutable(
      this.config.security?.hook_runner?.executable ?? 'docker',
    );
    const image = this.config.security?.container_image;
    if (!image) {
      throw new SkillCapsuleRuntimeError(
        'CONTAINER_IMAGE_MISSING',
        'Container hook runner requires security.container_image to be configured.',
        false,
      );
    }

    const workspaceMountPath = this.config.security?.hook_runner?.workspace_mount_path ?? '/workspace';
    const networkMode =
      this.config.security?.hook_runner?.network_mode ??
      (this.config.security?.network_access === 'denied_by_default' ? 'none' : 'host');
    const mountMode = permission === 'read_only' ? 'ro' : 'rw';
    const args: string[] = [
      'run',
      '--rm',
      '--workdir',
      workspaceMountPath,
      '--volume',
      `${this.projectRoot}:${workspaceMountPath}:${mountMode}`,
    ];

    if (networkMode === 'none') {
      args.push('--network', 'none');
    }

    const limits = this.config.security?.resource_limits;
    if (limits?.cpu_shares) {
      args.push('--cpu-shares', String(limits.cpu_shares));
    }
    if (limits?.memory_mb) {
      args.push('--memory', `${limits.memory_mb}m`);
    }
    if (limits?.pids_limit) {
      args.push('--pids-limit', String(limits.pids_limit));
    }

    for (const [key, value] of Object.entries(extraEnv)) {
      if (value) {
        args.push('--env', `${key}=${value}`);
      }
    }

    args.push(image, parsed.file, ...parsed.args);
    const runnerSpec = this.wrapWindowsBatchExecutable(executable, args);
    return {
      file: runnerSpec.file,
      args: runnerSpec.args,
      env: this.buildHookProcessEnvironment({}),
      cwd: this.projectRoot,
      windowsVerbatimArguments: runnerSpec.windowsVerbatimArguments,
    };
  }

  private shouldUseContainerRunner(): boolean {
    const runner = this.config.security?.hook_runner;
    return Boolean(runner?.enforce && runner.mode === 'container');
  }

  private resolveHookRunnerExecutable(executable: string): string {
    if (executable.includes(path.sep) || executable.includes('/')) {
      return path.resolve(this.projectRoot, executable);
    }
    return executable;
  }

  private wrapWindowsBatchExecutable(
    file: string,
    args: string[],
  ): { file: string; args: string[]; windowsVerbatimArguments?: boolean } {
    if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) {
      return { file, args };
    }

    const comspec = process.env.ComSpec ?? 'cmd.exe';
    const commandLine = [file, ...args].map((arg) => this.quoteWindowsCmdArg(arg)).join(' ');
    return {
      file: comspec,
      args: ['/d', '/s', '/c', commandLine],
      windowsVerbatimArguments: true,
    };
  }

  private quoteWindowsCmdArg(value: string): string {
    if (!/[\s"]/u.test(value)) {
      return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private renderHookCommand(
    template: string,
    task: TaskPayload,
    classification: TaskClassification,
    priorResults: HookResult[],
  ): string {
    const values: Record<string, string> = {
      TASK: task.description,
      TASK_TYPE: classification.taskType,
      RISK: classification.risk,
      HOOK_RESULTS: priorResults.map((item) => `${item.id}:${item.status}`).join(', ') || 'none',
      ACTIVATED_ATOMS: '',
      ALLOWED_PATHS: (task.allowed_paths ?? ['*']).join(','),
      READONLY_PATHS: (task.readonly_paths ?? []).join(',') || 'none',
      CHANGED_FILES: (task.changed_files ?? []).join(' '),
      REMOTE: task.remote ?? 'origin',
      BRANCH: task.branch ?? 'main',
      TRIGGERS: classification.tags.join(','),
      PAIR_COUNT: '0',
    };

    return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => {
      if (!DEFAULT_ALLOWED_TEMPLATE_KEYS.has(key)) {
        throw new Error(`Template key is not allowlisted: ${key}`);
      }
      const value = values[key] ?? '';
      if (!this.isSafeTemplateValue(value)) {
        throw new Error(`Unsafe template value for ${key}`);
      }
      return value;
    });
  }

  private isSafeTemplateValue(value: string): boolean {
    if (value.length > 400) {
      return false;
    }
    return !/[\r\n`;&|><]/.test(value);
  }

  private summariseOutput(output: string, definition: HookDefinition): string {
    const maxWords =
      definition.summary?.max_tokens ??
      this.config.context_budget.hook_summary_max_tokens ??
      120;
    const words = output.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const clipped = words.slice(0, maxWords).join(' ');
    if (!clipped) {
      return 'No output.';
    }
    if (definition.summary?.mode === 'pass_fail_findings') {
      return clipped;
    }
    return clipped;
  }

  private buildRenderPlan(
    selections: AtomSelection[],
    classification: TaskClassification,
    budget: number,
    hookResults: Map<string, HookResult>,
  ) {
    const plans = selections.map((selection) => ({
      ...selection,
      renderLevel: this.selectRenderLevel(selection.atom, classification, selection.mandatory, hookResults),
    }));

    let total = plans.reduce((sum, item) => sum + (item.atom.token_estimate[item.renderLevel] ?? 0), 0);
    const downgradeOrder: RenderLevel[] = ['X', 'O', 'S'];

    while (total > budget) {
      const candidate = plans.find((item) => !item.mandatory && item.renderLevel !== 'S');
      if (!candidate) {
        break;
      }
      const currentIndex = downgradeOrder.indexOf(candidate.renderLevel);
      const nextLevel = downgradeOrder[currentIndex + 1];
      if (!nextLevel) {
        break;
      }
      total -= candidate.atom.token_estimate[candidate.renderLevel] ?? 0;
      candidate.renderLevel = nextLevel;
      total += candidate.atom.token_estimate[candidate.renderLevel] ?? 0;
    }

    return plans;
  }

  private selectRenderLevel(
    atom: AtomDefinition,
    classification: TaskClassification,
    mandatory: boolean,
    hookResults: Map<string, HookResult>,
  ): RenderLevel {
    const hasHookFailure = (atom.hooks ?? []).some((hook) => {
      const result = hookResults.get(hook.id);
      return result && result.status !== 'PASS';
    });

    if (classification.risk === 'low') {
      return mandatory || hasHookFailure ? 'O' : 'S';
    }
    if (classification.risk === 'medium') {
      return mandatory || hasHookFailure ? 'O' : 'S';
    }
    if (classification.risk === 'high' || classification.risk === 'critical') {
      return mandatory || this.isSafetyCritical(atom) || hasHookFailure ? 'X' : 'O';
    }
    return 'S';
  }

  private isSafetyCritical(atom: AtomDefinition): boolean {
    return (
      atom.kind === 'verification' ||
      atom.kind === 'external' ||
      atom.contract?.side_effects === 'external' ||
      Boolean(atom.hooks?.some((hook) => hook.required || hook.blocks_on_fail))
    );
  }

  private compileCapsule(
    task: TaskPayload,
    classification: TaskClassification,
    renderPlan: Array<{ atom: AtomDefinition; capsuleIds: string[]; renderLevel: RenderLevel }>,
    hookResults: Map<string, HookResult>,
  ): string {
    const lines: string[] = [];
    lines.push(`[Skill Capsule]`);
    lines.push(`Task: ${task.description}`);
    lines.push(`Task Type: ${classification.taskType}`);
    lines.push(`Risk: ${classification.risk}`);
    if (classification.intents.length > 0) {
      lines.push(`Negative Intents: ${classification.intents.join(', ')}`);
    }
    lines.push('');

    for (const item of renderPlan) {
      const template = item.atom.render[item.renderLevel] ?? item.atom.render.S;
      lines.push(`Atom: ${item.atom.id} [${item.renderLevel}]`);
      lines.push(this.renderAtomTemplate(template, task, classification, item.atom, hookResults));
      lines.push('');
    }

    if (hookResults.size > 0) {
      lines.push('Hook Summaries:');
      for (const result of hookResults.values()) {
        lines.push(`- ${result.id}: ${result.status} (${result.summary})`);
      }
    }

    return lines.join('\n').trim();
  }

  private renderAtomTemplate(
    template: string,
    task: TaskPayload,
    classification: TaskClassification,
    atom: AtomDefinition,
    hookResults: Map<string, HookResult>,
  ): string {
    const values: Record<string, string> = {
      TASK: task.description,
      TASK_TYPE: classification.taskType,
      RISK: classification.risk,
      HOOK_RESULTS:
        (atom.hooks ?? [])
          .map((hook) => hookResults.get(hook.id))
          .filter((item): item is HookResult => Boolean(item))
          .map((item) => `${item.id}:${item.status}`)
          .join(', ') || 'none',
      ACTIVATED_ATOMS: atom.id,
      ALLOWED_PATHS: (task.allowed_paths ?? ['*']).join(', '),
      READONLY_PATHS: (task.readonly_paths ?? []).join(', ') || 'none',
      CHANGED_FILES: (task.changed_files ?? []).join(', ') || 'none',
      REMOTE: task.remote ?? 'origin',
      BRANCH: task.branch ?? 'main',
      TRIGGERS: classification.tags.join(', ') || 'none',
      PAIR_COUNT: '0',
    };

    return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => values[key] ?? '');
  }

  private resolveBudget(requestedBudget: number | undefined, capsules: CapsuleDefinition[]): number {
    const capsuleBudget = capsules.reduce((maxBudget, capsule) => Math.max(maxBudget, capsule.default_budget ?? 0), 0);
    const fallbackBudget = requestedBudget ?? capsuleBudget ?? this.config.context_budget.default;
    return Math.min(fallbackBudget, this.config.context_budget.max);
  }

  private writeCompiledArtifact(result: ComposeResult, runId: string, parentArtifactId?: string): string {
    fs.mkdirSync(this.compiledDir, { recursive: true });
    const artifactId = this.buildArtifactId('compose');
    const outputPath = path.join(this.compiledDir, `${Date.now()}-compose.json`);
    this.writeArtifactWithIndex(
      outputPath,
      {
        id: artifactId,
        runId,
        parentArtifactId,
        receipt: result.receipt,
        task: result.task,
        classification: result.classification,
        renderPlan: result.renderPlan,
        compiledCapsule: result.compiledCapsule,
      },
      {
        id: artifactId,
        kind: 'compose',
        createdAt: new Date().toISOString(),
        runId,
        parentArtifactId,
        taskDescription: result.task.description,
        taskType: result.classification.taskType,
        status: 'ok',
        path: outputPath,
      },
    );
    return outputPath;
  }

  private writePreparationArtifact(
    result: PreparationResult,
    task: TaskPayload,
    classification: TaskClassification,
    runId: string,
    parentArtifactId?: string,
  ): string {
    fs.mkdirSync(this.compiledDir, { recursive: true });
    const artifactId = this.buildArtifactId('prepare');
    const outputPath = path.join(
      this.compiledDir,
      `${Date.now()}-prepare-${this.sanitizeFileLabel(result.atomId)}.json`,
    );
    this.writeArtifactWithIndex(
      outputPath,
      {
        id: artifactId,
        runId,
        parentArtifactId,
        atomId: result.atomId,
        task,
        classification,
        hookPlan: result.hookPlan,
        hookResults: result.hookResults,
        receipt: result.receipt,
        compiledCapsule: result.compiledCapsule,
      },
      {
        id: artifactId,
        kind: 'prepare',
        createdAt: new Date().toISOString(),
        runId,
        parentArtifactId,
        atomId: result.atomId,
        taskDescription: task.description,
        taskType: classification.taskType,
        status: result.receipt.status,
        path: outputPath,
      },
    );
    return outputPath;
  }

  private writeVerificationArtifact(
    result: VerificationResult,
    task: TaskPayload,
    classification: TaskClassification,
    runId: string,
    parentArtifactId?: string,
  ): string {
    fs.mkdirSync(this.compiledDir, { recursive: true });
    const artifactId = this.buildArtifactId('verify');
    const outputPath = path.join(
      this.compiledDir,
      `${Date.now()}-verify-${this.sanitizeFileLabel(result.atomId)}.json`,
    );
    this.writeArtifactWithIndex(
      outputPath,
      {
        id: artifactId,
        runId,
        parentArtifactId,
        atomId: result.atomId,
        task,
        classification,
        hookPlan: result.hookPlan,
        hookResults: result.hookResults,
        receipt: result.receipt,
      },
      {
        id: artifactId,
        kind: 'verify',
        createdAt: new Date().toISOString(),
        runId,
        parentArtifactId,
        atomId: result.atomId,
        taskDescription: task.description,
        taskType: classification.taskType,
        status: result.receipt.status,
        path: outputPath,
      },
    );
    return outputPath;
  }

  private readArtifactIndex(): ArtifactRecord[] {
    if (!fs.existsSync(this.artifactIndexPath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(this.artifactIndexPath, 'utf-8')) as ArtifactRecord[];
  }

  private writeArtifactWithIndex(
    artifactPath: string,
    artifactPayload: Record<string, unknown>,
    record: ArtifactRecord,
  ): void {
    this.writeJsonAtomic(artifactPath, artifactPayload);
    try {
      this.appendArtifactIndex(record);
    } catch (error) {
      if (fs.existsSync(artifactPath)) {
        fs.unlinkSync(artifactPath);
      }
      throw error;
    }
  }

  private appendArtifactIndex(record: ArtifactRecord): void {
    fs.mkdirSync(this.compiledDir, { recursive: true });
    const records = this.readArtifactIndex().filter((item) => item.id !== record.id);
    records.push(record);
    const { kept, removed } = this.computePrunedArtifactSets(records);
    for (const removedRecord of removed) {
      if (fs.existsSync(removedRecord.path)) {
        fs.unlinkSync(removedRecord.path);
      }
    }
    this.writeArtifactIndex(kept);
  }

  private writeArtifactIndex(records: ArtifactRecord[]): void {
    fs.mkdirSync(this.compiledDir, { recursive: true });
    this.writeTextAtomic(this.artifactIndexPath, `${JSON.stringify(records, null, 2)}\n`);
  }

  private computePrunedArtifactSets(records: ArtifactRecord[]): {
    kept: ArtifactRecord[];
    removed: ArtifactRecord[];
  } {
    const sorted = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const retention = this.config.artifact_retention;
    if (!retention?.enabled) {
      return { kept: sorted, removed: [] };
    }

    const maxTotal = retention.max_total ?? Number.POSITIVE_INFINITY;
    const maxPerKind = retention.max_per_kind ?? {};
    const perKindCount: Partial<Record<ArtifactRecord['kind'], number>> = {};
    const kept: ArtifactRecord[] = [];
    const removed: ArtifactRecord[] = [];

    for (const record of sorted) {
      const kindCount = perKindCount[record.kind] ?? 0;
      const kindLimit = maxPerKind[record.kind] ?? Number.POSITIVE_INFINITY;
      if (kindCount >= kindLimit || kept.length >= maxTotal) {
        removed.push(record);
        continue;
      }
      kept.push(record);
      perKindCount[record.kind] = kindCount + 1;
    }

    return { kept, removed };
  }

  private filterArtifacts(query: ArtifactQuery): ArtifactRecord[] {
    const records = this.readArtifactIndex();
    return records
      .filter((record) => {
        if (query.kind && record.kind !== query.kind) {
          return false;
        }
        if (query.runId && record.runId !== query.runId) {
          return false;
        }
        if (query.parentArtifactId && record.parentArtifactId !== query.parentArtifactId) {
          return false;
        }
        if (query.atomId && record.atomId !== query.atomId) {
          return false;
        }
        if (query.status && record.status !== query.status) {
          return false;
        }
        if (query.taskType && record.taskType !== query.taskType) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private resolveSuccessfulStatuses(kind?: ArtifactRecord['kind']): string[] {
    const successByKind: Record<ArtifactRecord['kind'], string> = {
      compose: 'ok',
      prepare: 'READY',
      verify: 'PASS',
    };
    if (kind) {
      return [successByKind[kind]];
    }
    return Object.values(successByKind);
  }

  private resolveFailureStatuses(kind?: ArtifactRecord['kind']): string[] {
    const failuresByKind: Record<ArtifactRecord['kind'], string[]> = {
      compose: [],
      prepare: ['BLOCKED'],
      verify: ['FAIL'],
    };
    if (kind) {
      return failuresByKind[kind];
    }
    return [...new Set(Object.values(failuresByKind).flat())];
  }

  private getArtifactRecord(idOrPath: string): ArtifactRecord {
    const records = this.readArtifactIndex();
    const record = records.find((item) => item.id === idOrPath || item.path === path.resolve(idOrPath));
    if (!record) {
      throw new SkillCapsuleRuntimeError('ARTIFACT_NOT_INDEXED', `Artifact not indexed: ${idOrPath}`, false, { idOrPath });
    }
    return record;
  }

  private extractTaskFromArtifactPayload(
    payload: Record<string, unknown>,
    artifact: ArtifactRecord,
  ): TaskPayload {
    const taskPayload =
      payload.task && typeof payload.task === 'object'
        ? (payload.task as Partial<TaskPayload>)
        : {};
    return {
      description: taskPayload.description ?? artifact.taskDescription ?? `Resume ${artifact.id}`,
      budget: taskPayload.budget,
      task_type: taskPayload.task_type ?? artifact.taskType,
      allowed_paths: taskPayload.allowed_paths ?? ['*'],
      readonly_paths: taskPayload.readonly_paths ?? [],
      changed_files: taskPayload.changed_files ?? [],
      remote: taskPayload.remote ?? 'origin',
      branch: taskPayload.branch ?? 'main',
      intents: taskPayload.intents ?? [],
      run_id: artifact.runId,
      parent_artifact_id: artifact.id,
    };
  }

  private archivePatch(patchPath: string, bucket: 'accepted' | 'rejected'): string | undefined {
    const pendingRoot = path.join(this.patchesDir, 'pending');
    const targetRoot = path.join(this.patchesDir, bucket);
    fs.mkdirSync(targetRoot, { recursive: true });
    const relativePending = path.relative(pendingRoot, patchPath);

    if (!relativePending.startsWith('..') && !path.isAbsolute(relativePending)) {
      const targetPath = path.join(targetRoot, relativePending);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.renameSync(patchPath, targetPath);
      return targetPath;
    }

    return undefined;
  }

  private bumpPatchVersion(version: string): string {
    const parts = version.split('.');
    const lastIndex = parts.length - 1;
    const numeric = Number(parts[lastIndex]);
    if (Number.isFinite(numeric)) {
      parts[lastIndex] = String(numeric + 1);
      return parts.join('.');
    }
    return `${version}.1`;
  }

  private sanitizeFileLabel(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
  }

  private async runAudited<T>(
    action: string,
    context: Record<string, unknown>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    this.appendAuditEvent('started', action, { ...context, startedAt });
    try {
      const result = await operation();
      this.appendAuditEvent('succeeded', action, { ...context, startedAt });
      return result;
    } catch (error) {
      this.appendAuditEvent('failed', action, {
        ...context,
        startedAt,
        ...formatRuntimeError(error).error,
      });
      throw error;
    }
  }

  private appendAuditEvent(
    status: 'started' | 'succeeded' | 'failed',
    action: string,
    payload: Record<string, unknown>,
  ): void {
    if (this.config.observability?.emit_jsonl === false) {
      return;
    }
    try {
      fs.mkdirSync(this.logsDir, { recursive: true });
      const logPath = path.join(this.logsDir, 'runtime.jsonl');
      const entry = {
        ts: new Date().toISOString(),
        status,
        action,
        ...payload,
      };
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must not break runtime behavior.
    }
  }

  private writeJsonAtomic(filePath: string, payload: unknown): void {
    this.writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  private writeTextAtomic(filePath: string, contents: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tempPath, contents);
    fs.renameSync(tempPath, filePath);
  }

  private buildArtifactId(kind: ArtifactRecord['kind']): string {
    return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private validateHookCommand(command: string, definition: HookDefinition): void {
    const policy = this.config.security?.hook_policy;
    const normalized = command.replace(/\s+/g, ' ').trim();
    if ((policy?.deny_shell_metacharacters ?? true) && /[;&|><`]/.test(normalized)) {
      throw new Error(`Hook command contains denied shell metacharacters: ${definition.id}`);
    }

    const allowedPrefixes =
      policy?.allowed_prefixes?.[definition.permission] ?? DEFAULT_HOOK_ALLOWED_PREFIXES[definition.permission];
    if ((policy?.enforce_command_allowlist ?? true) && !allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      throw new Error(`Hook command is not allowlisted for ${definition.permission}: ${definition.id}`);
    }

    if ((policy?.require_local_node_scripts_under_hooks ?? true) && normalized.startsWith('node ')) {
      const parsed = this.tokenizeCommand(normalized);
      const scriptPath = parsed.args[0];
      if (!scriptPath) {
        throw new Error(`Node hook command is missing a script path: ${definition.id}`);
      }
      const resolvedScriptPath = path.resolve(this.projectRoot, scriptPath);
      const allowedRoot = path.resolve(this.hooksDir, 'scripts');
      const relative = path.relative(allowedRoot, resolvedScriptPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Node hook script must stay under .skillcapsule/hooks/scripts: ${definition.id}`);
      }
    }
  }

  private tokenizeCommand(command: string): { file: string; args: string[] } {
    const tokens =
      command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
        if (
          (token.startsWith('"') && token.endsWith('"')) ||
          (token.startsWith("'") && token.endsWith("'"))
        ) {
          return token.slice(1, -1);
        }
        return token;
      }) ?? [];
    if (tokens.length === 0) {
      throw new Error('Hook command is empty.');
    }
    return {
      file: tokens[0],
      args: tokens.slice(1),
    };
  }

  private resolveParentArtifactId(runId: string, explicitParentId?: string): string | undefined {
    if (explicitParentId) {
      return explicitParentId;
    }
    return this.getLatestArtifact({ runId })?.id;
  }

  private buildRunId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private hookPlanToIds(plan: Record<HookPhase, PlannedHook[]>): Record<HookPhase, string[]> {
    return {
      before_render: plan.before_render.map((hook) => hook.id),
      before_action: plan.before_action.map((hook) => hook.id),
      after_action: plan.after_action.map((hook) => hook.id),
      on_failure: plan.on_failure.map((hook) => hook.id),
      on_patch_proposal: plan.on_patch_proposal.map((hook) => hook.id),
    };
  }

  private meetsRiskFloor(minRisk: RiskLevel | undefined, currentRisk: RiskLevel): boolean {
    if (!minRisk) {
      return true;
    }
    return RISK_ORDER[currentRisk] >= RISK_ORDER[minRisk];
  }

  private permissionAllowed(permission: string, phase: HookPhase): boolean {
    if (permission === 'read_only') {
      return true;
    }
    if (permission === 'read_write') {
      return phase !== 'before_render';
    }
    return phase !== 'before_render';
  }

  private makeSyntheticHookResult(
    plannedHook: PlannedHook,
    status: HookResult['status'],
    summary: string,
    definition?: HookDefinition,
  ): HookResult {
    return {
      id: plannedHook.id,
      status,
      phase: plannedHook.phase,
      kind: definition?.kind ?? 'verify',
      permission: definition?.permission ?? 'read_only',
      command: definition?.command ?? '',
      summary,
      rawOutput: '',
      exitCode: null,
      durationMs: 0,
      blocked: plannedHook.blocksOnFail && status !== 'PASS',
    };
  }
}

export default SkillCapsuleRuntime;
