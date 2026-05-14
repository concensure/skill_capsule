import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ArtifactStore } from './artifact-store';
import {
  ActivationResult,
  ArtifactLineage,
  ArtifactRecord,
  ArtifactPruneResult,
  ArtifactQuery,
  ArtifactResumePlan,
  ArtifactSummary,
  AuditCheck,
  AtomAuditResult,
  AtomRoutingSummary,
  CapabilityEvolutionResult,
  CapabilityHistoryResult,
  CapabilityInspectionResult,
  CapabilityLevel,
  CapabilitySelectionResult,
  AtomDefinition,
  CapsuleRoutingSummary,
  CapsuleDefinition,
  ComposeResult,
  GovernanceReport,
  HookDefinition,
  HookPermission,
  HookPhase,
  PatchApplyResult,
  PatchGovernance,
  PatchProposal,
  PatchProposalOp,
  PatchRiskClass,
  PreparationResult,
  HookRegistry,
  HookResult,
  PatchValidationResult,
  ToolPlanEntry,
  VerificationResult,
  RenderLevel,
  RiskLevel,
  RoutingManifest,
  RuntimeErrorEnvelope,
  SkillCapsuleConfig,
  TaskClassification,
  TaskPayload,
  TimeTraceEventRecord,
} from './types';
import { TemporalClient } from './temporal';
import {
  buildArtifactLineage,
  computePrunedArtifactSets,
  determineResumeAction,
  filterArtifactRecords,
  resolveFailureArtifactStatuses,
  resolveSuccessfulArtifactStatuses,
  summarizeArtifactRecords,
} from './artifact-policy';
import {
  buildAuditTemporalSummary,
  buildSelectionTemporalContext,
  determineAuditTemporalOutcome,
  evaluateCapabilityEvolution,
  resolveAtomCapabilityId,
  resolveCapabilityTemporalMetadata,
} from './capability-policy';
import {
  classifyCapabilityLevel,
  parseAtomDefinition,
  parseCapsuleDefinition,
  validateAtomAgainstAllRules,
} from './validators';

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
  'SESSION_ID',
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

interface RoutingAtomSelection {
  atom: AtomRoutingSummary;
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
  readonly routingManifestPath: string;
  readonly artifactStore: ArtifactStore;

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
    this.routingManifestPath = path.resolve(this.projectRoot, '.skillcapsule', 'routing.manifest.json');
    this.artifactStore = new ArtifactStore(this.compiledDir, this.artifactIndexPath);
  }

  listAtoms(): AtomDefinition[] {
    return this.readAtomDirectory(this.atomsDir);
  }

  listCapsules(): CapsuleDefinition[] {
    return this.readCapsuleDirectory(this.capsulesDir);
  }

  listHooks(): HookDefinition[] {
    const registryPath = path.join(this.hooksDir, 'hooks.registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as HookRegistry;
    return registry.hooks;
  }

  private readRoutingManifest(): RoutingManifest {
    if (!fs.existsSync(this.routingManifestPath)) {
      throw new SkillCapsuleRuntimeError(
        'ROUTING_INDEX_MISSING',
        'Routing manifest not found. Run "skillcap index" to generate .skillcapsule/routing.manifest.json.',
        false,
        { routingManifestPath: this.routingManifestPath },
      );
    }

    try {
      return JSON.parse(fs.readFileSync(this.routingManifestPath, 'utf-8')) as RoutingManifest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillCapsuleRuntimeError(
        'ROUTING_INDEX_INVALID',
        `Routing manifest is unreadable: ${message}`,
        false,
        { routingManifestPath: this.routingManifestPath },
      );
    }
  }

  private listRoutingAtoms(): AtomRoutingSummary[] {
    return this.readRoutingManifest().atoms ?? [];
  }

  private listRoutingCapsules(): CapsuleRoutingSummary[] {
    return this.readRoutingManifest().capsules ?? [];
  }

  inspectCapability(capabilityId: string): CapabilityInspectionResult {
    const matching = this.getRoutingAtomsForCapability(capabilityId);
    if (matching.length === 0) {
      throw new SkillCapsuleRuntimeError(
        'CAPABILITY_NOT_FOUND',
        `No atoms found for capability_id: ${capabilityId}`,
        false,
        { capabilityId },
      );
    }

    const atomMap = this.loadAtomClosureMap(matching.map((atom) => atom.id));
    return {
      capability_id: capabilityId,
      atom_count: matching.length,
      atoms: matching.map((summary) => {
        const atom = atomMap.get(summary.id);
        if (!atom) {
          throw new SkillCapsuleRuntimeError('ATOM_NOT_FOUND', `Atom definition not found: ${summary.id}`, false, {
            atomId: summary.id,
          });
        }
        const validation = validateAtomAgainstAllRules(atom, atomMap);
        return {
          id: atom.id,
          version: atom.version,
          capability_level: classifyCapabilityLevel(atom),
          risk_level: atom.locs_capsule?.risk_level ?? 'unknown',
          approval_policy: atom.locs_capsule?.approval_policy ?? 'unknown',
          audit_level: atom.locs_capsule?.audit_level ?? 'unknown',
          compatibility: atom.locs_capsule?.compatibility ?? [],
          swappable_group: atom.locs_capsule?.swappable_atom_group,
          success_evidence: atom.locs_capsule?.success_evidence ?? [],
          governance_valid: validation.valid,
          contract_violations: validation.violations.map((violation) => violation.rule),
          contract_warnings: validation.warnings.map((warning) => warning.rule),
        };
      }),
    };
  }

  selectCapability(capabilityId: string, projectConstraints: string[] = []): CapabilitySelectionResult {
    const candidates = this.getRoutingAtomsForCapability(capabilityId);
    if (candidates.length === 0) {
      throw new SkillCapsuleRuntimeError(
        'CAPABILITY_NOT_FOUND',
        `No atoms found for capability_id: ${capabilityId}`,
        false,
        { capabilityId },
      );
    }

    const atomMap = this.loadAtomClosureMap(candidates.map((atom) => atom.id));
    const fullCandidates = candidates
      .map((candidate) => atomMap.get(candidate.id))
      .filter((candidate): candidate is AtomDefinition => Boolean(candidate));
    const preferredGroup = this.resolvePreferredSwappableGroup(fullCandidates);
    const scored = candidates
      .map((summary) => {
        const atom = atomMap.get(summary.id);
        if (!atom) {
          throw new SkillCapsuleRuntimeError('ATOM_NOT_FOUND', `Atom definition not found: ${summary.id}`, false, {
            atomId: summary.id,
          });
        }
        return this.evaluateCapabilityCandidate(atom, atomMap, projectConstraints, preferredGroup);
      })
      .sort((left, right) => {
        if (left.eligible !== right.eligible) {
          return left.eligible ? -1 : 1;
        }
        if (left.capabilityLevel !== right.capabilityLevel) {
          return left.capabilityLevel - right.capabilityLevel;
        }
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (right.matched !== left.matched) {
          return right.matched - left.matched;
        }
        return left.atom.id.localeCompare(right.atom.id);
      });

    const selected = scored.find((candidate) => candidate.eligible);
    const temporalWarnings = this.recordSelectionTemporalEvent(
      capabilityId,
      selected?.atom,
      projectConstraints,
      selected?.score,
    );
    return {
      capability_id: capabilityId,
      selected_atom: selected?.atom.id,
      selected_version: selected?.atom.version,
      compatibility_score: selected?.score ?? 0,
      compatibility_matched: selected?.matched ?? 0,
      compatibility_constraints: projectConstraints,
      temporal_warnings: temporalWarnings,
      all_candidates: scored.map((candidate) => {
        const isSelected = selected?.atom.id === candidate.atom.id;
        const rejectionReasons = isSelected
          ? []
          : candidate.rejectionReasons.length > 0
            ? candidate.rejectionReasons
            : ['not_selected:higher_ranked_candidate'];

        return {
          atom_id: candidate.atom.id,
          version: candidate.atom.version,
          capability_level: candidate.capabilityLevel,
          governance_valid: candidate.governanceValid,
          eligible: candidate.eligible,
          selected: isSelected,
          compatibility_score: candidate.score,
          matched: candidate.matched,
          missing: candidate.missing,
          rejection_reasons: rejectionReasons,
        };
      }),
    };
  }

  auditAtom(atomId: string): AtomAuditResult {
    const atomMap = this.loadAtomClosureMap([atomId]);
    const atom = atomMap.get(atomId);
    if (!atom) {
      throw new SkillCapsuleRuntimeError('ATOM_NOT_FOUND', `Atom not found: ${atomId}`, false, { atomId });
    }

    const validation = validateAtomAgainstAllRules(atom, atomMap);
    const latestPrepare = this.getLatestArtifact({ kind: 'prepare', atomId });
    const latestVerify = this.getLatestArtifact({ kind: 'verify', atomId });
    const latestSuccessfulPrepare = this.getLatestSuccessfulArtifact({ kind: 'prepare', atomId });
    const latestSuccessfulVerify = this.getLatestSuccessfulArtifact({ kind: 'verify', atomId });
    const latestSuccessArtifact = latestSuccessfulVerify ?? latestSuccessfulPrepare ?? null;
    const satisfiedEvidence = this.inferSatisfiedEvidence(atom, latestPrepare, latestVerify);
    const requiredEvidence = atom.locs_capsule?.success_evidence ?? [];
    const missingEvidence = requiredEvidence.filter((item) => !satisfiedEvidence.includes(item));
    const checks = this.buildAuditChecks(
      atom,
      validation,
      latestPrepare,
      latestVerify,
      requiredEvidence,
      satisfiedEvidence,
      missingEvidence,
    );
    const temporalWarnings = this.recordAuditTemporalReceipt(atom, validation.valid, checks);

    return {
      atom_id: atomId,
      capability_level: classifyCapabilityLevel(atom),
      valid: validation.valid,
      violations: validation.violations,
      warnings: validation.warnings,
      locs_capsule: atom.locs_capsule ?? null,
      checks,
      temporal_warnings: temporalWarnings,
      evidence_summary: {
        latest_prepare_status: latestPrepare?.status,
        latest_verify_status: latestVerify?.status,
        latest_success_artifact_id: latestSuccessArtifact?.id,
        success_evidence: requiredEvidence,
        satisfied_evidence: satisfiedEvidence,
        missing_evidence: missingEvidence,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Temporal intelligence methods  (T10, T11)
  // ---------------------------------------------------------------------------

  /**
   * Retrieve truth-priority ordered temporal history for a capability.
   *
   * Requires TimeTrace (`tt`) to be installed in PATH and a `.timetrace`
   * workspace initialised in the project root.  Degrades gracefully when
   * unavailable: returns an empty event list with `temporal_available: false`.
   *
   * Pass `scope` to filter events by temporal_scope category (e.g.
   * "audit-results", "selection-history", "regression-events").
   */
  historyCapability(capabilityId: string, requestedScope?: string): CapabilityHistoryResult {
    const capabilityAtoms = this.getRoutingAtomsForCapability(capabilityId);
    if (capabilityAtoms.length === 0) {
      throw new SkillCapsuleRuntimeError(
        'CAPABILITY_NOT_FOUND',
        `No atoms found for capability_id: ${capabilityId}`,
        false,
        { capabilityId },
      );
    }

    const temporalMetadata = resolveCapabilityTemporalMetadata(capabilityAtoms);
    const client = this.buildTemporalClient();
    try {
      const history = client.getCapabilityHistory(capabilityId);
      const warnings = [...history.warnings];
      if (requestedScope && !temporalMetadata.scopes.includes(requestedScope)) {
        warnings.push(`Requested scope "${requestedScope}" is not declared by any atom for this capability.`);
      } else if (requestedScope) {
        warnings.push(
          `Requested scope "${requestedScope}" is advisory only; current TimeTrace CLI returns capability-wide history.`,
        );
      }
      if (!temporalMetadata.tracked) {
        warnings.push('Capability does not declare temporal_tracking in any current atom profile.');
      }

      return {
        capability_id: capabilityId,
        provider: 'timetrace',
        workspace_path: history.workspacePath,
        temporal_tracking_declared: temporalMetadata.tracked,
        temporal_scopes: temporalMetadata.scopes,
        event_count: history.events.length,
        events: history.events,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillCapsuleRuntimeError(
        'TIMETRACE_HISTORY_UNAVAILABLE',
        message,
        false,
        { capabilityId, requestedScope },
      );
    }
  }

  /**
   * Analyse capability trend history and produce a promotion/demotion
   * recommendation.
   *
   * Uses TimeTrace comparison stats through the external CLI contract.
   * Missing TimeTrace setup is treated as an operational error.
   */
  evolveCapability(capabilityId: string): CapabilityEvolutionResult {
    const capabilityAtoms = this.getRoutingAtomsForCapability(capabilityId);
    if (capabilityAtoms.length === 0) {
      throw new SkillCapsuleRuntimeError(
        'CAPABILITY_NOT_FOUND',
        `No atoms found for capability_id: ${capabilityId}`,
        false,
        { capabilityId },
      );
    }

    const temporalMetadata = resolveCapabilityTemporalMetadata(capabilityAtoms);
    const client = this.buildTemporalClient();
    try {
      const comparison = client.getCapabilityComparison(capabilityId);
      const evaluation = evaluateCapabilityEvolution(comparison.stats);
      const warnings = [...comparison.warnings];
      if (!temporalMetadata.tracked) {
        warnings.push('Capability does not declare temporal_tracking in any current atom profile.');
      }

      return {
        capability_id: capabilityId,
        provider: 'timetrace',
        workspace_path: comparison.workspacePath,
        temporal_tracking_declared: temporalMetadata.tracked,
        temporal_scopes: temporalMetadata.scopes,
        stats: comparison.stats,
        recommendation: evaluation.recommendation,
        confidence_gate: evaluation.confidenceGate,
        reasoning: evaluation.reasoning,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillCapsuleRuntimeError(
        'TIMETRACE_EVOLUTION_UNAVAILABLE',
        message,
        false,
        { capabilityId },
      );
    }

    /* legacy temporal heuristic
    if (available) {
      const stats = client.getCapabilityComparison(capabilityId);
      if (stats) {
        const reasons: string[] = [];
        let recommendation: CapabilityEvolutionResult['recommendation'];

        if (stats.has_recent_rollback) {
          reasons.push(`Recent rollback detected — require explicit re-approval before promotion.`);
        }

        if (stats.confidence === 'stable' && stats.approval_rate >= 0.8 && !stats.has_recent_rollback) {
          recommendation = 'promote';
          reasons.push(
            `Approval rate ${(stats.approval_rate * 100).toFixed(0)}% over ${stats.audit_count} audit(s).`,
          );
          reasons.push(`Evidence quality: ${stats.evidence_quality}. Confidence: ${stats.confidence}.`);
        } else if (stats.confidence === 'unstable' || stats.approval_rate < 0.4 || stats.has_recent_rollback) {
          recommendation = 'demote';
          reasons.push(
            `Approval rate ${(stats.approval_rate * 100).toFixed(0)}% is below the 40% threshold.`,
          );
          if (stats.rollback_count > 0) {
            reasons.push(`${stats.rollback_count} rollback(s) recorded.`);
          }
        } else {
          recommendation = 'stay';
          reasons.push(`Approval rate ${(stats.approval_rate * 100).toFixed(0)}% — watch for improvement.`);
        }

        return {
          capability_id: capabilityId,
          temporal_available: true,
          recommendation,
          confidence: stats.confidence,
          evidence_quality: stats.evidence_quality,
          approval_rate: stats.approval_rate,
          audit_count: stats.audit_count,
          has_recent_rollback: stats.has_recent_rollback,
          reasons,
        };
      }
    }

    // --- Fallback: derive recommendation from local governance metrics ---
    const governanceReport = this.readGovernanceReport();
    const matchingAtoms = this.getRoutingAtomsForCapability(capabilityId);

    if (matchingAtoms.length === 0) {
      throw new SkillCapsuleRuntimeError(
        'CAPABILITY_NOT_FOUND',
        `No atoms found for capability_id: ${capabilityId}`,
        false,
        { capabilityId },
      );
    }

    const reasons: string[] = [
      'TimeTrace not available — using local governance metrics only.',
      'For richer temporal analysis, install `tt` and run `tt init`.',
    ];

    let avgTokenEfficiency: number | null = null;
    let avgHookPassRate: number | null = null;

    if (governanceReport) {
      const atomMetrics = matchingAtoms
        .map((atom) => governanceReport.atoms.find((m) => m.atom_id === atom.id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));

      const teValues = atomMetrics.map((m) => m.token_efficiency).filter((v): v is number => v !== null);
      if (teValues.length > 0) {
        avgTokenEfficiency = teValues.reduce((a, b) => a + b, 0) / teValues.length;
      }

      const hpValues = atomMetrics.map((m) => m.hook_pass_rate).filter((v): v is number => v !== null);
      if (hpValues.length > 0) {
        avgHookPassRate = hpValues.reduce((a, b) => a + b, 0) / hpValues.length;
      }
    }

    // Simple heuristic without audit history
    const recommendation: CapabilityEvolutionResult['recommendation'] =
      avgHookPassRate !== null && avgHookPassRate >= 0.9 ? 'promote'
      : avgHookPassRate !== null && avgHookPassRate < 0.5 ? 'demote'
      : 'stay';

    if (avgTokenEfficiency !== null) {
      reasons.push(`Local avg token efficiency: ${(avgTokenEfficiency * 100).toFixed(0)}%.`);
    }
    if (avgHookPassRate !== null) {
      reasons.push(`Local avg hook pass rate: ${(avgHookPassRate * 100).toFixed(0)}%.`);
    }

    return {
      capability_id: capabilityId,
      temporal_available: false,
      recommendation,
      confidence: 'watch',
      evidence_quality: 'low',
      approval_rate: 0,
      audit_count: 0,
      has_recent_rollback: false,
      reasons,
      local_governance: {
        atom_count: matchingAtoms.length,
        average_token_efficiency: avgTokenEfficiency,
        average_hook_pass_rate: avgHookPassRate,
      },
    };
    */
  }

  // ---------------------------------------------------------------------------

  listArtifacts(query: ArtifactQuery = {}): ArtifactRecord[] {
    return this.filterArtifacts(query).slice(0, query.limit ?? 20);
  }

  getLatestArtifact(query: ArtifactQuery = {}): ArtifactRecord | null {
    return this.filterArtifacts({ ...query, limit: undefined })[0] ?? null;
  }

  getLatestSuccessfulArtifact(query: ArtifactQuery = {}): ArtifactRecord | null {
    const successStatuses = resolveSuccessfulArtifactStatuses(query.kind);
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
    return summarizeArtifactRecords(records);
  }

  getArtifactLineage(runId: string): ArtifactLineage {
    const artifacts = this.filterArtifacts({ runId, limit: undefined });
    if (artifacts.length === 0) {
      throw new SkillCapsuleRuntimeError('ARTIFACT_LINEAGE_NOT_FOUND', `Artifact lineage not found for run: ${runId}`, false, { runId });
    }
    return buildArtifactLineage(runId, artifacts);
  }

  resumeFromArtifact(idOrPath: string): ArtifactResumePlan {
    const artifact = this.getArtifactRecord(idOrPath);
    const payload = this.getArtifact(idOrPath);
    const task = this.extractTaskFromArtifactPayload(payload, artifact);

    if (artifact.kind === 'compose') {
      return {
        sourceArtifactId: artifact.id,
        runId: artifact.runId,
        recommendedAction: determineResumeAction(artifact),
        task,
      };
    }

    if (artifact.kind === 'prepare') {
      return {
        sourceArtifactId: artifact.id,
        runId: artifact.runId,
        recommendedAction: determineResumeAction(artifact),
        atomId: artifact.atomId,
        task,
      };
    }

    return {
      sourceArtifactId: artifact.id,
      runId: artifact.runId,
      recommendedAction: determineResumeAction(artifact),
      atomId: artifact.atomId,
      task,
    };
  }

  getLatestFailedArtifact(query: ArtifactQuery = {}): ArtifactRecord | null {
    const failureStatuses = resolveFailureArtifactStatuses(query.kind);
    const filtered = this.filterArtifacts({ ...query, limit: undefined }).filter((record) =>
      failureStatuses.includes(record.status ?? ''),
    );
    return filtered[0] ?? null;
  }

  getArtifact(idOrPath: string): Record<string, unknown> {
    const records = this.readArtifactIndex();
    const record = records.find((item) => item.id === idOrPath || item.path === path.resolve(idOrPath));
    const resolvedPath = record?.path ?? path.resolve(idOrPath);
    if (!this.artifactStore.exists(resolvedPath)) {
      throw new SkillCapsuleRuntimeError('ARTIFACT_NOT_FOUND', `Artifact not found: ${idOrPath}`, false, { idOrPath });
    }
    return this.artifactStore.readPayload(resolvedPath);
  }

  pruneArtifacts(): ArtifactPruneResult {
    const records = this.readArtifactIndex();
    const { kept, removed } = this.computePrunedArtifactSets(records);
    for (const record of removed) {
      if (this.artifactStore.exists(record.path)) {
        this.artifactStore.remove(record.path);
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
      task.session_id = task.session_id ?? runId;
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

      const approvalAtoms = selections
        .filter((s) => s.atom.activation_mode === 'approval')
        .map((s) => s.atom.id);
      const toolPlan = this.buildToolPlan(selections, hookPlan);

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
          requires_approval: approvalAtoms.length > 0,
          approval_atoms: approvalAtoms,
        },
        tool_plan: toolPlan,
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
      task.session_id = task.session_id ?? runId;
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
      task.session_id = task.session_id ?? runId;
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

    validation.governance = this.computePatchGovernance(patch);
    return validation;
  }

  private readGovernanceReport(): GovernanceReport | null {
    const metricsPath = path.join(this.capsuleRoot, 'metrics', 'governance.json');
    if (!fs.existsSync(metricsPath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as GovernanceReport;
    } catch {
      return null;
    }
  }

  private patchRiskClass(patch: PatchProposal): PatchRiskClass {
    const LOW_OPS = new Set([
      'add_example', 'deprecate_example', 'append_evidence',
      'tighten_activation', 'remove_trigger_keyword',
    ]);
    const MEDIUM_OPS = new Set(['replace_render', 'add_trigger_keyword', 'change_status']);
    let highest: PatchRiskClass = 'low';
    for (const op of patch.ops ?? []) {
      if (MEDIUM_OPS.has(op.op) && highest === 'low') {
        highest = 'medium';
      }
      if (!LOW_OPS.has(op.op) && !MEDIUM_OPS.has(op.op)) {
        highest = 'high';
      }
    }
    return highest;
  }

  private computePatchGovernance(patch: PatchProposal): PatchGovernance {
    const riskClass = this.patchRiskClass(patch);
    const report = this.readGovernanceReport();

    if (!report) {
      return {
        decision: riskClass === 'high' ? 'needs_human_approval' : 'auto_approvable',
        reason: 'No governance metrics available yet.',
        patch_risk_class: riskClass,
        metrics_available: false,
      };
    }

    const metrics = report.atoms.find((m) => m.atom_id === patch.target_atom);
    const hasEvidence = metrics !== undefined && metrics.sample_count >= 3;

    if (riskClass === 'high') {
      return {
        decision: 'needs_human_approval',
        reason: 'High-risk patch operation requires human review.',
        patch_risk_class: riskClass,
        metrics_available: hasEvidence,
      };
    }

    if (!hasEvidence) {
      return {
        decision: riskClass === 'medium' ? 'needs_human_approval' : 'auto_approvable',
        reason: 'Insufficient evidence samples for governance comparison.',
        patch_risk_class: riskClass,
        metrics_available: false,
      };
    }

    return {
      decision: 'auto_approvable',
      reason: `${metrics!.sample_count} evidence samples. Low/medium risk patch passes ratchet.`,
      patch_risk_class: riskClass,
      metrics_available: true,
    };
  }

  private buildToolPlan(
    selections: AtomSelection[],
    hookPlan: Record<HookPhase, PlannedHook[]>,
  ): ToolPlanEntry[] {
    const atomModeMap = new Map(
      selections.map((s) => [s.atom.id, s.atom.activation_mode ?? 'activate']),
    );
    const toolPlan: ToolPlanEntry[] = [];
    for (const phase of Object.keys(hookPlan) as HookPhase[]) {
      for (const hook of hookPlan[phase]) {
        const atomMode = atomModeMap.get(hook.atomId) ?? 'activate';
        toolPlan.push({
          hook: hook.id,
          phase,
          mode: hook.requiresUserApproval ? 'approval' : atomMode,
          approval: hook.requiresUserApproval,
        });
      }
    }
    return toolPlan;
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
        session_id: taskInput.session_id,
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

  private readAtomDirectory(directory: string): AtomDefinition[] {
    if (!fs.existsSync(directory)) {
      return [];
    }

    return fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const raw = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8')) as unknown;
        const parsed = parseAtomDefinition(raw, file);
        if (!parsed.atom) {
          throw new SkillCapsuleRuntimeError(
            'ATOM_SCHEMA_INVALID',
            `Atom schema invalid: ${file}`,
            false,
            { file, violations: parsed.violations },
          );
        }
        return parsed.atom;
      });
  }

  private readCapsuleDirectory(directory: string): CapsuleDefinition[] {
    if (!fs.existsSync(directory)) {
      return [];
    }

    return fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const raw = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8')) as unknown;
        const parsed = parseCapsuleDefinition(raw, file);
        if (!parsed.capsule) {
          throw new SkillCapsuleRuntimeError(
            'CAPSULE_SCHEMA_INVALID',
            `Capsule schema invalid: ${file}`,
            false,
            { file, violations: parsed.violations },
          );
        }
        return parsed.capsule;
      });
  }

  private readPatch(patchPath: string): PatchProposal {
    return JSON.parse(fs.readFileSync(path.resolve(patchPath), 'utf-8')) as PatchProposal;
  }

  private collectHookResultMap(results: HookResult[]): Map<string, HookResult> {
    return new Map(results.map((result) => [result.id, result]));
  }

  private getAtom(atomId: string): AtomDefinition {
    return this.loadAtomDefinition(atomId);
  }

  private getRoutingAtomsForCapability(capabilityId: string): AtomRoutingSummary[] {
    return this.listRoutingAtoms()
      .filter((atom) => atom.capability_id === capabilityId || atom.locs_capsule?.capability_id === capabilityId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private loadAtomDefinition(atomId: string): AtomDefinition {
    const routingSummary = fs.existsSync(this.routingManifestPath)
      ? this.listRoutingAtoms().find((atom) => atom.id === atomId)
      : undefined;
    const candidatePath = path.join(this.atomsDir, routingSummary?.file ?? `${atomId}.json`);
    if (!fs.existsSync(candidatePath)) {
      throw new SkillCapsuleRuntimeError('ATOM_NOT_FOUND', `Atom definition not found: ${atomId}`, false, { atomId });
    }
    const raw = JSON.parse(fs.readFileSync(candidatePath, 'utf-8')) as unknown;
    const parsed = parseAtomDefinition(raw, path.basename(candidatePath));
    if (!parsed.atom) {
      throw new SkillCapsuleRuntimeError(
        'ATOM_SCHEMA_INVALID',
        `Atom schema invalid: ${path.basename(candidatePath)}`,
        false,
        { file: candidatePath, violations: parsed.violations },
      );
    }
    return parsed.atom;
  }

  // T7: progressive reveal — cap on atoms loaded in a single context window.
  // A higher count suggests a full-registry preload that violates load-order discipline.
  private static readonly MAX_ATOMS_PER_CONTEXT = 20;

  private loadAtomClosureMap(atomIds: string[]): Map<string, AtomDefinition> {
    const loaded = new Map<string, AtomDefinition>();
    const queue = [...new Set(atomIds)];

    while (queue.length > 0) {
      const atomId = queue.shift();
      if (!atomId || loaded.has(atomId)) {
        continue;
      }
      const atom = this.loadAtomDefinition(atomId);
      loaded.set(atom.id, atom);
      for (const dependency of atom.dependencies ?? []) {
        if (!loaded.has(dependency)) {
          queue.push(dependency);
        }
      }
    }

    // T7 guardrail: warn when the closure grows beyond the progressive-reveal budget.
    // This indicates full-registry or full-history preload in a default flow, which
    // inflates token cost and breaks the CIF → contract → atom load order.
    if (loaded.size > SkillCapsuleRuntime.MAX_ATOMS_PER_CONTEXT) {
      process.stderr.write(
        `[skill-capsule] WARN progressive-reveal: loaded ${loaded.size} atoms in a single ` +
        `context (limit: ${SkillCapsuleRuntime.MAX_ATOMS_PER_CONTEXT}). ` +
        `Scope your query via capability_id or a narrower capsule to reduce token cost.\n`,
      );
    }

    return loaded;
  }

  private buildAuditChecks(
    atom: AtomDefinition,
    validation: ReturnType<typeof validateAtomAgainstAllRules>,
    latestPrepare: ArtifactRecord | null,
    latestVerify: ArtifactRecord | null,
    requiredEvidence: string[],
    satisfiedEvidence: string[],
    missingEvidence: string[],
  ): AuditCheck[] {
    const checks: AuditCheck[] = [];

    checks.push({
      name: 'contract_compliance',
      status: validation.valid ? 'PASS' : 'FAIL',
      detail: validation.valid
        ? 'Capability contract validation passed.'
        : `Contract violations: ${validation.violations.map((violation) => violation.rule).join(', ')}`,
    });

    const unresolvedDependencies = (atom.dependencies ?? []).filter((dependency) =>
      validation.violations.some(
        (violation) => violation.rule === 'UNRESOLVED_DEPENDENCY' && violation.message.includes(dependency),
      ),
    );
    checks.push({
      name: 'dependency_integrity',
      status: unresolvedDependencies.length === 0 ? 'PASS' : 'FAIL',
      detail:
        unresolvedDependencies.length === 0
          ? 'All declared dependencies resolved.'
          : `Unresolved dependencies: ${unresolvedDependencies.join(', ')}`,
    });

    let evidenceStatus: AuditCheck['status'] = 'PASS';
    let evidenceDetail = 'All declared success evidence satisfied.';
    if (requiredEvidence.length === 0) {
      evidenceStatus = 'WARN';
      evidenceDetail = 'No success_evidence declared for this atom.';
    } else if (!latestPrepare && !latestVerify) {
      evidenceStatus = 'WARN';
      evidenceDetail = `No recent prepare/verify artifacts found. Unable to verify evidence: ${requiredEvidence.join(', ')}`;
    } else if (missingEvidence.length > 0) {
      evidenceStatus = 'FAIL';
      evidenceDetail = `Missing success evidence: ${missingEvidence.join(', ')}. Satisfied: ${satisfiedEvidence.join(', ') || 'none'}`;
    }
    checks.push({
      name: 'execution_evidence',
      status: evidenceStatus,
      detail: evidenceDetail,
    });

    const requiresApproval =
      atom.activation_mode === 'approval' ||
      Boolean(atom.hooks?.some((hook) => hook.requires_user_approval)) ||
      atom.locs_capsule?.approval_policy === 'approval-required' ||
      atom.locs_capsule?.approval_policy === 'human-review-required';
    let approvalStatus: AuditCheck['status'] = 'PASS';
    let approvalDetail = 'No explicit approval requirement declared.';
    if (requiresApproval) {
      approvalStatus = 'WARN';
      approvalDetail =
        'Approval-sensitive atom detected, but explicit approval receipts are not yet modeled in compiled artifacts.';
    }
    checks.push({
      name: 'approval_compliance',
      status: approvalStatus,
      detail: approvalDetail,
    });

    const scopeCheck = this.findLatestHookResult(latestVerify, 'hook.diff.scope_check');
    const unexpectedFileChangesStatus: AuditCheck['status'] =
      scopeCheck?.status === 'PASS' ? 'PASS' : scopeCheck?.status === 'FAIL' ? 'FAIL' : 'WARN';
    checks.push({
      name: 'unexpected_file_changes',
      status: unexpectedFileChangesStatus,
      detail:
        scopeCheck?.status === 'PASS'
          ? 'Scope guard verified expected file changes.'
          : scopeCheck?.status === 'FAIL'
            ? `Scope guard reported unexpected file changes: ${scopeCheck.summary}`
            : 'No scope guard evidence available for this atom.',
    });

    const latestStatus = latestVerify?.status ?? latestPrepare?.status;
    let exitStatus: AuditCheck['status'] = 'WARN';
    let exitDetail = 'No recent prepare/verify artifact found.';
    if (latestVerify) {
      exitStatus = latestVerify.status === 'PASS' ? 'PASS' : 'FAIL';
      exitDetail = `Latest verify artifact status: ${latestVerify.status}`;
    } else if (latestPrepare) {
      exitStatus = latestPrepare.status === 'READY' ? 'PASS' : latestPrepare.status === 'BLOCKED' ? 'FAIL' : 'WARN';
      exitDetail = `Latest prepare artifact status: ${latestStatus}`;
    }
    checks.push({
      name: 'exit_status',
      status: exitStatus,
      detail: exitDetail,
    });

    return checks;
  }

  private inferSatisfiedEvidence(
    atom: AtomDefinition,
    latestPrepare: ArtifactRecord | null,
    latestVerify: ArtifactRecord | null,
  ): string[] {
    const satisfied = new Set<string>();
    const preparePayload = latestPrepare ? this.safeReadArtifactPayload(latestPrepare.path) : null;
    const verifyPayload = latestVerify ? this.safeReadArtifactPayload(latestVerify.path) : null;

    if (preparePayload?.hookResults?.before_render?.some((result: { id?: string; status?: string }) => result.id === 'hook.git.status' && result.status === 'PASS')) {
      satisfied.add('git_status_collected');
    }
    if (preparePayload?.hookResults?.before_action?.some((result: { id?: string; status?: string }) => result.id === 'hook.secrets.scan' && result.status === 'PASS')) {
      satisfied.add('secret_scan_passed');
    }
    if (verifyPayload?.hookResults?.after_action?.some((result: { id?: string; status?: string }) => result.id === 'hook.verify.typecheck' && result.status === 'PASS')) {
      satisfied.add('typecheck_passed');
    }
    if (verifyPayload?.hookResults?.after_action?.some((result: { id?: string; status?: string }) => result.id === 'hook.diff.scope_check' && result.status === 'PASS')) {
      satisfied.add('diff_scope_check_passed');
    }
    if (verifyPayload?.hookResults?.after_action?.some((result: { id?: string; status?: string }) => result.id === 'hook.test.related' && result.status === 'PASS')) {
      satisfied.add('related_tests_passed');
    }
    if (atom.id === 'github.commit.message') {
      satisfied.add('commit_message_drafted');
    }
    if (verifyPayload?.hookResults?.after_action?.some((result: { id?: string; status?: string }) => result.id === 'hook.github.push' && result.status === 'PASS')) {
      satisfied.add('push_command_authorized');
      satisfied.add('push_command_succeeded');
    }

    return Array.from(satisfied).sort();
  }

  private findLatestHookResult(artifact: ArtifactRecord | null, hookId: string): HookResult | null {
    if (!artifact) {
      return null;
    }
    const payload = this.safeReadArtifactPayload(artifact.path);
    if (!payload?.hookResults || typeof payload.hookResults !== 'object') {
      return null;
    }

    for (const results of Object.values(payload.hookResults as Record<string, HookResult[]>)) {
      const match = Array.isArray(results) ? results.find((result) => result.id === hookId) : null;
      if (match) {
        return match;
      }
    }
    return null;
  }

  private safeReadArtifactPayload(filePath: string): Record<string, any> | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
    } catch {
      return null;
    }
  }

  private resolvePreferredSwappableGroup(candidates: AtomDefinition[]): string | undefined {
    const groups = candidates
      .map((candidate) => candidate.locs_capsule?.swappable_atom_group)
      .filter((group): group is string => Boolean(group));
    if (groups.length === 0) {
      return undefined;
    }

    const counts = new Map<string, number>();
    for (const group of groups) {
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }

    return Array.from(counts.entries()).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })[0]?.[0];
  }

  private evaluateCapabilityCandidate(
    atom: AtomDefinition,
    atomMap: Map<string, AtomDefinition>,
    projectConstraints: string[],
    preferredGroup?: string,
  ): {
    atom: AtomDefinition;
    capabilityLevel: CapabilityLevel;
    governanceValid: boolean;
    eligible: boolean;
    score: number;
    matched: number;
    missing: string[];
    rejectionReasons: string[];
  } {
    const compatibility = atom.locs_capsule?.compatibility ?? [];
    const missing = compatibility.filter((constraint) => !projectConstraints.includes(constraint));
    const matched = projectConstraints.filter((constraint) => compatibility.includes(constraint)).length;
    const score = matched / Math.max(compatibility.length, 1);
    const validation = validateAtomAgainstAllRules(atom, atomMap);
    const rejectionReasons: string[] = [];

    if (!validation.valid) {
      for (const violation of validation.violations) {
        rejectionReasons.push(`governance:${violation.rule}`);
      }
    }

    const swappableGroup = atom.locs_capsule?.swappable_atom_group;
    if (preferredGroup && swappableGroup && swappableGroup !== preferredGroup) {
      rejectionReasons.push(`swappable_group_mismatch:${swappableGroup}`);
    }

    if (projectConstraints.length > 0 && missing.length > 0) {
      rejectionReasons.push(`missing_compatibility:${missing.join(',')}`);
    }

    return {
      atom,
      capabilityLevel: classifyCapabilityLevel(atom),
      governanceValid: validation.valid,
      eligible: rejectionReasons.length === 0,
      score,
      matched,
      missing,
      rejectionReasons,
    };
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
    const atoms = this.listRoutingAtoms();
    const capsules = this.listRoutingCapsules();
    const matchedAtoms = atoms.filter((atom) => this.atomMatches(atom, classification));
    const matchedIds = new Set(matchedAtoms.map((atom) => atom.id));

    const selectedCapsules = capsules.filter(
      (capsule) => capsule.type !== 'stage' && capsule.atoms.some((atomId) => matchedIds.has(atomId)),
    );
    const selectionMap = new Map<string, RoutingAtomSelection>();

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

    const resolvedIds = this.resolveSelectionAtomIds(Array.from(selectionMap.values()), atoms, classification);
    const fullAtomMap = this.loadAtomClosureMap(resolvedIds);
    const selections = resolvedIds
      .map((atomId) => {
        const fullAtom = fullAtomMap.get(atomId);
        if (!fullAtom) {
          throw new SkillCapsuleRuntimeError('ATOM_NOT_FOUND', `Atom definition not found: ${atomId}`, false, {
            atomId,
          });
        }
        const meta = selectionMap.get(atomId);
        return {
          atom: fullAtom,
          capsuleIds: meta?.capsuleIds ?? [],
          mandatory: meta?.mandatory ?? true,
        };
      })
      .sort((left, right) => left.atom.id.localeCompare(right.atom.id));
    return { selections, selectedCapsules };
  }

  private atomMatches(atom: Pick<AtomDefinition, 'id' | 'triggers' | 'activation'>, classification: TaskClassification): boolean {
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

  private atomAllowedByIntent(
    atom: Pick<AtomDefinition, 'triggers'>,
    classification: TaskClassification,
  ): boolean {
    const blockedBy = atom.triggers.blocked_by_intents ?? [];
    return !blockedBy.some((intent) => classification.intents.includes(intent));
  }

  private resolveSelectionAtomIds(
    selections: Array<{ atom: Pick<AtomRoutingSummary, 'id' | 'dependencies' | 'conflicts' | 'triggers'> }>,
    atoms: Array<Pick<AtomRoutingSummary, 'id' | 'dependencies' | 'conflicts' | 'triggers'>>,
    classification: TaskClassification,
  ): string[] {
    const selectionMap = new Map(selections.map((selection) => [selection.atom.id, selection]));
    const atomMap = new Map(atoms.map((atom) => [atom.id, atom]));
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
        const dependency = atomMap.get(dependencyId);
        if (!dependency || !this.atomAllowedByIntent(dependency, classification)) {
          continue;
        }
        const selection = {
          atom: dependency,
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

    return Array.from(selectionMap.values())
      .map((selection) => selection.atom.id)
      .filter((atomId) => !conflicts.has(atomId))
      .sort((left, right) => left.localeCompare(right));
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
      SC_SESSION_ID: task.session_id ?? '',
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
      SESSION_ID: task.session_id ?? '',
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

    const approvalAtoms = renderPlan
      .filter((item) => item.atom.activation_mode === 'approval')
      .map((item) => item.atom.id);
    if (approvalAtoms.length > 0) {
      lines.push('[APPROVAL REQUIRED]');
      lines.push(`Atoms requiring explicit approval before execution: ${approvalAtoms.join(', ')}`);
      lines.push('');
    }

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
      SESSION_ID: task.session_id ?? '',
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

  private resolveBudget(
    requestedBudget: number | undefined,
    capsules: Array<Pick<CapsuleDefinition, 'default_budget'>>,
  ): number {
    const capsuleBudget = capsules.reduce((maxBudget, capsule) => Math.max(maxBudget, capsule.default_budget ?? 0), 0);
    const fallbackBudget = requestedBudget ?? capsuleBudget ?? this.config.context_budget.default;
    return Math.min(fallbackBudget, this.config.context_budget.max);
  }

  private writeCompiledArtifact(result: ComposeResult, runId: string, parentArtifactId?: string): string {
    this.artifactStore.ensureCompiledDir();
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
    this.artifactStore.ensureCompiledDir();
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
    this.artifactStore.ensureCompiledDir();
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
    return this.artifactStore.readIndex();
  }

  private writeArtifactWithIndex(
    artifactPath: string,
    artifactPayload: Record<string, unknown>,
    record: ArtifactRecord,
  ): void {
    this.artifactStore.writePayload(artifactPath, artifactPayload);
    try {
      this.appendArtifactIndex(record);
    } catch (error) {
      if (this.artifactStore.exists(artifactPath)) {
        this.artifactStore.remove(artifactPath);
      }
      throw error;
    }
  }

  private appendArtifactIndex(record: ArtifactRecord): void {
    this.artifactStore.ensureCompiledDir();
    const records = this.readArtifactIndex().filter((item) => item.id !== record.id);
    records.push(record);
    const { kept, removed } = this.computePrunedArtifactSets(records);
    for (const removedRecord of removed) {
      if (this.artifactStore.exists(removedRecord.path)) {
        this.artifactStore.remove(removedRecord.path);
      }
    }
    this.writeArtifactIndex(kept);
  }

  private writeArtifactIndex(records: ArtifactRecord[]): void {
    this.artifactStore.writeIndex(records);
  }

  private computePrunedArtifactSets(records: ArtifactRecord[]): {
    kept: ArtifactRecord[];
    removed: ArtifactRecord[];
  } {
    return computePrunedArtifactSets(records, this.config.artifact_retention);
  }

  private filterArtifacts(query: ArtifactQuery): ArtifactRecord[] {
    return filterArtifactRecords(this.readArtifactIndex(), query);
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
    this.artifactStore.writePayload(filePath, payload);
  }

  private writeTextAtomic(filePath: string, contents: string): void {
    this.artifactStore.writeText(filePath, contents);
  }

  private buildArtifactId(kind: ArtifactRecord['kind']): string {
    return this.artifactStore.buildArtifactId(kind);
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

  private buildTemporalClient(): TemporalClient {
    return new TemporalClient(this.projectRoot, this.config);
  }

  private recordSelectionTemporalEvent(
    capabilityId: string,
    selectedAtom: AtomDefinition | undefined,
    projectConstraints: string[],
    score?: number,
  ): string[] {
    if (!this.config.temporal?.record_selection_events) {
      return [];
    }
    if (!selectedAtom) {
      return ['TimeTrace selection recording skipped because no eligible atom was selected.'];
    }

    const context = buildSelectionTemporalContext(selectedAtom, projectConstraints);
    try {
      const client = this.buildTemporalClient();
      const result = client.recordSelectionEvent(capabilityId, context, score);
      return result.warnings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [`TimeTrace selection recording failed: ${message}`];
    }
  }

  private recordAuditTemporalReceipt(
    atom: AtomDefinition,
    valid: boolean,
    checks: AuditCheck[],
  ): string[] {
    if (!this.config.temporal?.record_audit_receipts) {
      return [];
    }

    const capabilityId = resolveAtomCapabilityId(atom);
    if (!capabilityId) {
      return ['TimeTrace audit recording skipped because the atom has no capability_id.'];
    }

    const outcome = determineAuditTemporalOutcome(valid, checks);
    const summary = buildAuditTemporalSummary(atom, outcome, checks);

    try {
      const client = this.buildTemporalClient();
      const result = client.recordAuditReceipt(capabilityId, outcome, summary);
      return result.warnings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [`TimeTrace audit recording failed: ${message}`];
    }
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
