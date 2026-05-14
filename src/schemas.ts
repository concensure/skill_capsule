import { z } from 'zod';

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
const capabilityLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const renderLevelSchema = z.enum(['S', 'O', 'X']);
const activationModeSchema = z.enum(['activate', 'inspect', 'block', 'approval']);
const hookPhaseSchema = z.enum([
  'before_render',
  'before_action',
  'after_action',
  'on_failure',
  'on_patch_proposal',
]);
const hookKindSchema = z.enum(['observe', 'verify', 'summarise', 'mutate', 'external']);
const hookPermissionSchema = z.enum(['read_only', 'read_write', 'restricted_exec']);
const stateModelSchema = z.enum(['external-boundary', 'internal-state', 'stateless']);
const determinismSchema = z.enum([
  'deterministic',
  'deterministic-if-environment-stable',
  'non-deterministic',
]);
const sideEffectSchema = z.enum(['none', 'read-only', 'explicit', 'implicit']);
const approvalPolicySchema = z.enum([
  'auto',
  'auto-if-readonly',
  'approval-required',
  'human-review-required',
]);
const auditLevelSchema = z.enum(['none', 'minimal', 'standard', 'strict']);

const stringArraySchema = z.array(z.string().min(1));

export const atomTriggerRulesSchema = z
  .object({
    keywords: stringArraySchema.optional(),
    task_types: stringArraySchema.optional(),
    blocked_by_intents: stringArraySchema.optional(),
    auto_activate: z.boolean().optional(),
  })
  .passthrough();

export const atomActivationSchema = z
  .object({
    risk_min: riskLevelSchema.optional(),
    auto_activate: z.boolean().optional(),
  })
  .passthrough();

export const atomHookBindingSchema = z
  .object({
    id: z.string().min(1),
    phase: hookPhaseSchema,
    kind: z.string().min(1).optional(),
    required: z.boolean().optional(),
    blocks_on_fail: z.boolean().optional(),
    requires_user_approval: z.boolean().optional(),
  })
  .passthrough();

export const atomContractSchema = z
  .object({
    requires_context: stringArraySchema.optional(),
    side_effects: z.enum(['none', 'read_only', 'mutate', 'external']).optional(),
    guarantees: stringArraySchema.optional(),
  })
  .passthrough();

export const locsCapsuleProfileSchema = z
  .object({
    capability_id: z.string().min(1),
    capability_name: z.string().min(1),
    capability_summary: z.string().min(1),
    state_model: stateModelSchema,
    side_effects: sideEffectSchema,
    determinism: determinismSchema,
    risk_level: riskLevelSchema,
    approval_policy: approvalPolicySchema,
    audit_level: auditLevelSchema,
    swappable_atom_group: z.string().min(1),
    compatibility: stringArraySchema,
    success_evidence: stringArraySchema,
    token_efficiency: z.number().finite().nonnegative().optional(),
    benchmark_ref: z.string().min(1).optional(),
    dependency_depth: z.number().int().nonnegative().optional(),
    capability_score: z.number().finite().nonnegative().optional(),
    temporal_tracking: z.boolean().optional(),
    temporal_scope: stringArraySchema.optional(),
  })
  .passthrough();

export const atomDefinitionSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    kind: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    contract: atomContractSchema.optional(),
    source: z
      .object({
        file: z.string().min(1),
        section_id: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    triggers: atomTriggerRulesSchema,
    activation: atomActivationSchema.optional(),
    dependencies: stringArraySchema.optional(),
    conflicts: stringArraySchema.optional(),
    hooks: z.array(atomHookBindingSchema).optional(),
    render: z.object({
      S: z.string(),
      O: z.string(),
      X: z.string(),
    }),
    token_estimate: z.object({
      S: z.number().int().nonnegative(),
      O: z.number().int().nonnegative(),
      X: z.number().int().nonnegative(),
    }),
    autonomy_level: z.string().min(1).optional(),
    locs_level: capabilityLevelSchema.optional(),
    locs_module_ref: z.string().min(1).optional(),
    activation_mode: activationModeSchema.optional(),
    capability_id: z.string().min(1).optional(),
    locs_capsule: locsCapsuleProfileSchema.optional(),
  })
  .passthrough();

export const capsuleDefinitionSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    type: z.string().min(1).optional(),
    description: z.string().optional(),
    atoms: stringArraySchema,
    default_budget: z.number().int().nonnegative().optional(),
    risk_policy: z
      .object({
        low: renderLevelSchema.optional(),
        medium: renderLevelSchema.optional(),
        high: renderLevelSchema.optional(),
        critical: renderLevelSchema.optional(),
      })
      .passthrough()
      .optional(),
    status: z.string().min(1).optional(),
  })
  .passthrough();

export const hookDefinitionSchema = z
  .object({
    id: z.string().min(1),
    command: z.string().min(1),
    permission: hookPermissionSchema,
    kind: z.string().min(1),
    timeout_ms: z.number().int().positive(),
    phases: z.array(z.string().min(1)).min(1),
    depends_on: stringArraySchema.optional(),
    requires_user_approval: z.boolean().optional(),
    summary: z
      .object({
        mode: z.string().min(1).optional(),
        max_tokens: z.number().int().positive().optional(),
      })
      .passthrough()
      .optional(),
    os: stringArraySchema.optional(),
  })
  .passthrough();

export const hookRegistrySchema = z
  .object({
    hooks: z.array(hookDefinitionSchema),
  })
  .passthrough();

export type AtomDefinitionInput = z.infer<typeof atomDefinitionSchema>;
export type CapsuleDefinitionInput = z.infer<typeof capsuleDefinitionSchema>;
