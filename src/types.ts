export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RenderLevel = 'S' | 'O' | 'X';
export type ActivationMode = 'activate' | 'inspect' | 'block' | 'approval';
export type PatchRiskClass = 'low' | 'medium' | 'high';
export type GovernanceDecision = 'auto_approvable' | 'needs_human_approval' | 'rejected';
export type CapabilityLevel = 0 | 1 | 2;
export type HookPhase =
  | 'before_render'
  | 'before_action'
  | 'after_action'
  | 'on_failure'
  | 'on_patch_proposal';
export type HookKind = 'observe' | 'verify' | 'summarise' | 'mutate' | 'external';
export type HookPermission = 'read_only' | 'read_write' | 'restricted_exec';
export type HookStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

export interface SkillCapsuleConfig {
  project_name?: string;
  version?: string;
  base_dir?: string;
  capsule_dir?: string;
  atom_dir?: string;
  hook_dir?: string;
  outcome_dir?: string;
  patch_dir?: string;
  default_token_budget?: number;
  context_budget: {
    default: number;
    max: number;
    hook_summary_max_tokens?: number;
    mandatory_budget_reserved: Record<RiskLevel, number>;
  };
  artifact_retention?: {
    enabled?: boolean;
    max_total?: number;
    max_per_kind?: Partial<Record<'compose' | 'prepare' | 'verify', number>>;
  };
  meta_evolution?: {
    hot_path_analysis?: boolean;
  };
  security?: {
    sandbox_mode?: string;
    container_image?: string;
    network_access?: string;
    hook_runner?: {
      mode?: 'process' | 'container';
      enforce?: boolean;
      executable?: string;
      workspace_mount_path?: string;
      network_mode?: 'none' | 'host';
    };
    resource_limits?: {
      cpu_shares?: number;
      memory_mb?: number;
      pids_limit?: number;
    };
    hook_policy?: {
      enforce_command_allowlist?: boolean;
      deny_shell_metacharacters?: boolean;
      require_local_node_scripts_under_hooks?: boolean;
      allowed_env_passthrough?: string[];
      allowed_prefixes?: Partial<Record<HookPermission, string[]>>;
    };
  };
  observability?: {
    log_dir?: string;
    emit_jsonl?: boolean;
  };
  temporal?: {
    enabled?: boolean;
    provider?: 'timetrace';
    workspace_dir?: string;
    project_dir?: string;
    binary?: string;
    binary_args?: string[];
    allow_cargo_run?: boolean;
    record_selection_events?: boolean;
    record_audit_receipts?: boolean;
  };
}

export interface AtomTriggerRules {
  keywords?: string[];
  task_types?: string[];
  blocked_by_intents?: string[];
  auto_activate?: boolean;
}

export interface AtomActivation {
  risk_min?: RiskLevel;
  auto_activate?: boolean;
}

export interface AtomHookBinding {
  id: string;
  phase: HookPhase;
  kind?: HookKind;
  required?: boolean;
  blocks_on_fail?: boolean;
  requires_user_approval?: boolean;
}

export interface AtomContract {
  requires_context?: string[];
  side_effects?: 'none' | 'read_only' | 'mutate' | 'external';
  guarantees?: string[];
}

export type StateModel = 'external-boundary' | 'internal-state' | 'stateless';
export type Determinism = 'deterministic' | 'deterministic-if-environment-stable' | 'non-deterministic';
export type SideEffect = 'none' | 'read-only' | 'explicit' | 'implicit';
export type ApprovalPolicy = 'auto' | 'auto-if-readonly' | 'approval-required' | 'human-review-required';
export type AuditLevel = 'none' | 'minimal' | 'standard' | 'strict';

export interface LocsCapsuleProfile {
  // Required fields
  capability_id: string;
  capability_name: string;
  capability_summary: string;
  state_model: StateModel;
  side_effects: SideEffect;
  determinism: Determinism;
  risk_level: RiskLevel;
  approval_policy: ApprovalPolicy;
  audit_level: AuditLevel;
  swappable_atom_group: string;
  compatibility: string[];
  success_evidence: string[];
  
  // Optional fields
  token_efficiency?: number;
  benchmark_ref?: string;
  dependency_depth?: number;
  capability_score?: number;
  temporal_tracking?: boolean;
  temporal_scope?: string[];
}

export interface AtomDefinition {
  id: string;
  version: string;
  kind?: string;
  status?: string;
  contract?: AtomContract;
  source?: {
    file: string;
    section_id?: string;
  };
  triggers: AtomTriggerRules;
  activation?: AtomActivation;
  dependencies?: string[];
  conflicts?: string[];
  hooks?: AtomHookBinding[];
  render: Record<RenderLevel, string>;
  token_estimate: Record<RenderLevel, number>;
  autonomy_level?: string;
  locs_level?: CapabilityLevel;
  locs_module_ref?: string;
  activation_mode?: ActivationMode;
  capability_id?: string;
  locs_capsule?: LocsCapsuleProfile;
}

export interface CapsuleDefinition {
  id: string;
  version: string;
  type?: string;
  description?: string;
  atoms: string[];
  default_budget?: number;
  risk_policy?: Partial<Record<RiskLevel, RenderLevel>>;
  status?: string;
}

export interface HookSummaryConfig {
  mode?: string;
  max_tokens?: number;
}

export interface HookDefinition {
  id: string;
  command: string;
  permission: HookPermission;
  kind: HookKind;
  timeout_ms: number;
  phases: HookPhase[];
  depends_on?: string[];
  requires_user_approval?: boolean;
  summary?: HookSummaryConfig;
  os?: string[];
}

export interface HookRegistry {
  hooks: HookDefinition[];
}

export interface TaskPayload {
  description: string;
  budget?: number;
  task_type?: string;
  allowed_paths?: string[];
  readonly_paths?: string[];
  changed_files?: string[];
  remote?: string;
  branch?: string;
  intents?: string[];
  run_id?: string;
  parent_artifact_id?: string;
  session_id?: string;
}

export interface TaskClassification {
  raw: string;
  taskType: string;
  risk: RiskLevel;
  intents: string[];
  tags: string[];
}

export interface HookResult {
  id: string;
  status: HookStatus;
  phase: HookPhase;
  kind: HookKind;
  permission: HookPermission;
  command: string;
  summary: string;
  rawOutput: string;
  exitCode: number | null;
  durationMs: number;
  blocked: boolean;
}

export interface ToolPlanEntry {
  hook: string;
  phase: HookPhase;
  mode: ActivationMode;
  approval: boolean;
}

export interface PatchGovernance {
  decision: GovernanceDecision;
  reason: string;
  patch_risk_class: PatchRiskClass;
  metrics_available: boolean;
}

export interface AtomGovernanceMetrics {
  atom_id: string;
  sample_count: number;
  token_efficiency: number | null;
  hook_pass_rate: number | null;
  activation_accept_rate: number | null;
  computed_at: string;
}

export interface GovernanceReport {
  version: string;
  computed_at: string;
  atoms: AtomGovernanceMetrics[];
}

export interface MutationRecord {
  patch_id: string | null;
  mutation: string;
  decision: 'accepted' | 'rejected' | 'pending';
  decision_mode: 'auto' | 'human';
  scorecard_before: Partial<Record<string, number | null>>;
  scorecard_after: Partial<Record<string, number | null>>;
  evidence_run_ids: string[];
}

export interface OutcomeRecord {
  atom_id?: string | null;
  task_type?: string | null;
  activation_accepted: boolean | null;
  matched_atoms: string[];
  expected_atoms: string[] | null;
  hook_results?: Array<{ id: string; status: string }> | null;
  mutation_record?: MutationRecord | null;
  [key: string]: unknown;
}

export interface ComposeResult {
  runId: string;
  task: TaskPayload;
  classification: TaskClassification;
  selectedCapsules: string[];
  atoms: string[];
  renderPlan: Array<{
    atomId: string;
    capsuleIds: string[];
    renderLevel: RenderLevel;
    tokenCost: number;
  }>;
  hookPlan: Record<HookPhase, string[]>;
  hookResults: Partial<Record<HookPhase, HookResult[]>>;
  receipt: {
    taskType: string;
    risk: RiskLevel;
    intents: string[];
    capsules: string[];
    atoms: string[];
    hooks: Record<HookPhase, string[]>;
    requires_approval: boolean;
    approval_atoms: string[];
  };
  tool_plan: ToolPlanEntry[];
  compiledCapsule: string;
  artifactPath?: string;
}

export interface ActivationResult {
  runId: string;
  atomId: string;
  renderLevel: RenderLevel;
  hookPlan: Record<HookPhase, string[]>;
  hookResults: Partial<Record<HookPhase, HookResult[]>>;
  compiledCapsule: string;
}

export interface PreparationResult {
  runId: string;
  atomId: string;
  renderLevel: RenderLevel;
  hookPlan: Record<HookPhase, string[]>;
  hookResults: Partial<Record<HookPhase, HookResult[]>>;
  receipt: {
    status: 'READY' | 'BLOCKED';
    blockingHooks: string[];
    executedPhases: HookPhase[];
  };
  compiledCapsule: string;
  artifactPath?: string;
}

export interface VerificationResult {
  runId: string;
  atomId: string;
  hookPlan: Record<HookPhase, string[]>;
  hookResults: Partial<Record<HookPhase, HookResult[]>>;
  receipt: {
    status: 'PASS' | 'FAIL';
    blockingHooks: string[];
    executedPhases: HookPhase[];
  };
  artifactPath?: string;
}

export interface ArtifactRecord {
  id: string;
  kind: 'compose' | 'prepare' | 'verify';
  createdAt: string;
  runId?: string;
  parentArtifactId?: string;
  atomId?: string;
  taskDescription?: string;
  taskType?: string;
  status?: string;
  path: string;
}

export interface ArtifactQuery {
  kind?: ArtifactRecord['kind'];
  runId?: string;
  parentArtifactId?: string;
  atomId?: string;
  status?: string;
  taskType?: string;
  limit?: number;
}

export interface ArtifactSummary {
  total: number;
  runIds: number;
  byKind: Partial<Record<ArtifactRecord['kind'], number>>;
  byStatus: Record<string, number>;
  byTaskType: Record<string, number>;
  latestCreatedAt?: string;
}

export interface ArtifactLineage {
  runId: string;
  artifacts: ArtifactRecord[];
  roots: string[];
  childrenByParent: Record<string, string[]>;
}

export interface ArtifactResumePlan {
  sourceArtifactId: string;
  runId?: string;
  recommendedAction: 'compose' | 'prepare' | 'verify';
  atomId?: string;
  task: TaskPayload;
}

export interface RuntimeErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export interface DiagnosticCheck {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  configPath: string;
  projectRoot?: string;
  checks: DiagnosticCheck[];
}

export interface ArtifactPruneResult {
  removed: ArtifactRecord[];
  kept: number;
}

export interface PatchValidationResult {
  status: 'PASS' | 'FAIL';
  violations: string[];
  governance?: PatchGovernance;
}

export interface PatchProposalOp {
  op: string;
  field?: string;
  value?: unknown;
  level?: RenderLevel;
  note?: string;
}

export interface PatchProposal {
  target_atom: string;
  base_version: string;
  ops: PatchProposalOp[];
}

export interface PatchApplyResult {
  status: 'APPLIED' | 'REJECTED';
  targetAtom: string;
  atomPath: string;
  patchPath: string;
  archivedPatchPath?: string;
  newVersion: string;
  appliedOps: string[];
}
export interface CIFEntry {
  intent_terms: string[];
  capability_id: string;
  risk: RiskLevel;
  swappable_atom_group?: string;
  mode: ActivationMode;
  compatible_atoms: string[];
}

export interface AtomRoutingSummary {
  id: string;
  file: string;
  version: string;
  capability_level: CapabilityLevel;
  capability_id?: string;
  triggers: AtomTriggerRules;
  activation?: AtomActivation;
  dependencies?: string[];
  conflicts?: string[];
  activation_mode?: ActivationMode;
  locs_capsule?: LocsCapsuleProfile;
}

export interface CapsuleRoutingSummary {
  id: string;
  version: string;
  type?: string;
  atoms: string[];
  default_budget?: number;
  status?: string;
}

export interface RoutingManifest {
  version: string;
  generated_at: string;
  atoms: AtomRoutingSummary[];
  capsules: CapsuleRoutingSummary[];
}

export interface ValidationViolation {
  atom_id: string;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  remediation?: string;
}

export interface ContractValidationResult {
  atom_id: string;
  valid: boolean;
  violations: ValidationViolation[];
  warnings: ValidationViolation[];
}

export interface CapabilityInspectionAtom {
  id: string;
  version: string;
  capability_level: CapabilityLevel;
  risk_level: RiskLevel | 'unknown';
  approval_policy: ApprovalPolicy | 'unknown';
  audit_level: AuditLevel | 'unknown';
  compatibility: string[];
  swappable_group?: string;
  success_evidence: string[];
  governance_valid: boolean;
  contract_violations: string[];
  contract_warnings: string[];
}

export interface CapabilityInspectionResult {
  capability_id: string;
  atom_count: number;
  atoms: CapabilityInspectionAtom[];
}

export interface CapabilitySelectionCandidate {
  atom_id: string;
  version: string;
  capability_level: CapabilityLevel;
  governance_valid: boolean;
  eligible: boolean;
  selected: boolean;
  compatibility_score: number;
  matched: number;
  missing: string[];
  rejection_reasons: string[];
}

export interface CapabilitySelectionResult {
  capability_id: string;
  selected_atom?: string;
  selected_version?: string;
  compatibility_score: number;
  compatibility_matched: number;
  compatibility_constraints: string[];
  all_candidates: CapabilitySelectionCandidate[];
  temporal_warnings?: string[];
}

export interface AtomAuditResult {
  atom_id: string;
  capability_level: CapabilityLevel;
  valid: boolean;
  violations: ValidationViolation[];
  warnings: ValidationViolation[];
  locs_capsule: LocsCapsuleProfile | null;
  checks: AuditCheck[];
  temporal_warnings?: string[];
  evidence_summary: {
    latest_prepare_status?: string;
    latest_verify_status?: string;
    latest_success_artifact_id?: string;
    success_evidence: string[];
    satisfied_evidence: string[];
    missing_evidence: string[];
  };
}

export interface AuditCheck {
  name:
    | 'contract_compliance'
    | 'dependency_integrity'
    | 'execution_evidence'
    | 'approval_compliance'
    | 'unexpected_file_changes'
    | 'exit_status';
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

export interface TimeTraceEventRecord {
  event_id: string;
  event_type: string;
  timestamp: string;
  repo: string;
  files: string[];
  symbols: unknown[];
  diff_loc: number | null;
  bug_signature: string | null;
  capability_id: string | null;
  atom_id: string | null;
  verified: string;
  evidence: {
    test_command: string | null;
    test_status: string | null;
    commit_hash: string | null;
    linked_events: string[];
    outcome: string | null;
    score: number | null;
    notes: string[];
  };
  summary: string | null;
}

export interface TimeTraceComparisonStats {
  total_events: number;
  audit_count: number;
  approved_count: number;
  rejected_count: number;
  verified_count: number;
  rollback_count: number;
  mutation_count: number;
  approval_rate: number;
  evidence_quality: string;
  has_recent_rollback: boolean;
  confidence: string;
}

export interface CapabilityHistoryResult {
  capability_id: string;
  provider: 'timetrace';
  workspace_path: string;
  temporal_tracking_declared: boolean;
  temporal_scopes: string[];
  event_count: number;
  events: TimeTraceEventRecord[];
  warnings: string[];
}

export interface CapabilityEvolutionResult {
  capability_id: string;
  provider: 'timetrace';
  workspace_path: string;
  temporal_tracking_declared: boolean;
  temporal_scopes: string[];
  stats: TimeTraceComparisonStats;
  recommendation: 'promote' | 'stay' | 'demote';
  confidence_gate: 'high' | 'medium' | 'low';
  reasoning: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Token-efficiency discipline types  (T12)
// ---------------------------------------------------------------------------

export interface TokenEfficiencyViolation {
  atom_id: string;
  check: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface TokenEfficiencyReport {
  checked_at: string;
  atom_count: number;
  violations: TokenEfficiencyViolation[];
  warnings: TokenEfficiencyViolation[];
  total_contract_bytes: number;
  oversized_atoms: string[];
}
