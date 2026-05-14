import { ZodError } from 'zod';
import {
  AtomDefinition,
  CapabilityLevel,
  CapsuleDefinition,
  ContractValidationResult,
  LocsCapsuleProfile,
  RiskLevel,
  ValidationViolation,
} from './types';
import { atomDefinitionSchema, capsuleDefinitionSchema } from './schemas';

/**
 * Validators for LOCS-Capsule Profile v1.
 * They keep Level 0 atoms lightweight while enforcing deterministic rules
 * for atoms that opt into capability contracts.
 */

const RISK_HIERARCHY: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface ParsedAtomResult {
  atom: AtomDefinition | null;
  violations: ValidationViolation[];
}

export interface ParsedCapsuleResult {
  capsule: CapsuleDefinition | null;
  violations: ValidationViolation[];
}

function normalizeLegacyAtomShape(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const raw = { ...(input as Record<string, unknown>) };
  const normalized = { ...raw };

  if (Array.isArray(raw.triggers)) {
    normalized.triggers = {
      keywords: raw.triggers,
      ...(Array.isArray(raw.task_types) ? { task_types: raw.task_types } : {}),
    };
  }

  if (!normalized.triggers || typeof normalized.triggers !== 'object' || Array.isArray(normalized.triggers)) {
    normalized.triggers = {
      keywords: [],
      ...(Array.isArray(raw.task_types) ? { task_types: raw.task_types } : {}),
    };
  } else if (Array.isArray(raw.task_types) && !Array.isArray((normalized.triggers as { task_types?: unknown }).task_types)) {
    normalized.triggers = {
      ...(normalized.triggers as Record<string, unknown>),
      task_types: raw.task_types,
    };
  }

  if (Array.isArray(raw.hooks)) {
    normalized.hooks = raw.hooks.map((hook) =>
      typeof hook === 'string'
        ? { id: hook, phase: 'before_action' }
        : hook && typeof hook === 'object' && (hook as { phase?: unknown }).phase === 'verify'
          ? { ...(hook as Record<string, unknown>), phase: 'after_action' }
          : hook,
    );
  }

  if (!raw.activation && typeof raw.risk === 'string') {
    normalized.activation = { risk_min: raw.risk };
  }

  if (!raw.activation_mode && typeof raw.mode === 'string') {
    normalized.activation_mode = raw.mode === 'automatic' ? 'activate' : raw.mode;
  } else if (raw.activation_mode === 'automatic') {
    normalized.activation_mode = 'activate';
  }

  if (!raw.render) {
    const summary =
      typeof raw.description === 'string'
        ? raw.description
        : typeof raw.name === 'string'
          ? raw.name
          : typeof raw.id === 'string'
            ? raw.id
            : 'Legacy atom';
    normalized.render = {
      S: summary,
      O: summary,
      X: summary,
    };
  }

  if (!raw.token_estimate) {
    normalized.token_estimate = { S: 20, O: 40, X: 80 };
  }

  return normalized;
}

function normalizeLegacyCapsuleShape(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const raw = { ...(input as Record<string, unknown>) };
  const normalized = { ...raw };

  if (!Array.isArray(raw.atoms) && Array.isArray(raw.composition)) {
    normalized.atoms = raw.composition;
  }

  if (!raw.type) {
    if (
      typeof raw.id === 'string' && raw.id.startsWith('stage.') ||
      typeof raw.name === 'string' && raw.name.startsWith('Stage:') ||
      Array.isArray(raw.composition) ||
      typeof raw.governance === 'object'
    ) {
      normalized.type = 'stage';
    } else if (typeof raw.name === 'string') {
      normalized.type = 'capsule';
    }
  }

  return normalized;
}

function makeViolation(
  atomId: string,
  rule: string,
  message: string,
  remediation?: string,
  severity: 'error' | 'warning' = 'error',
): ValidationViolation {
  return {
    atom_id: atomId,
    rule,
    severity,
    message,
    remediation,
  };
}

function zodIssuesToViolations(atomId: string, error: ZodError): ValidationViolation[] {
  return error.issues.map((issue) =>
    makeViolation(
      atomId,
      'ATOM_SCHEMA_INVALID',
      `${issue.path.join('.') || '<root>'}: ${issue.message}`,
      'Fix the atom JSON to satisfy the runtime schema.',
    ),
  );
}

export function parseAtomDefinition(input: unknown, sourceLabel = '<unknown>'): ParsedAtomResult {
  const parsed = atomDefinitionSchema.safeParse(normalizeLegacyAtomShape(input));
  if (!parsed.success) {
    const atomId =
      typeof input === 'object' && input !== null && 'id' in input && typeof (input as { id?: unknown }).id === 'string'
        ? (input as { id: string }).id
        : sourceLabel;
    return {
      atom: null,
      violations: zodIssuesToViolations(atomId, parsed.error),
    };
  }

  return {
    atom: parsed.data as AtomDefinition,
    violations: [],
  };
}

export function parseCapsuleDefinition(input: unknown, sourceLabel = '<unknown>'): ParsedCapsuleResult {
  const parsed = capsuleDefinitionSchema.safeParse(normalizeLegacyCapsuleShape(input));
  if (!parsed.success) {
    const capsuleId =
      typeof input === 'object' && input !== null && 'id' in input && typeof (input as { id?: unknown }).id === 'string'
        ? (input as { id: string }).id
        : sourceLabel;
    return {
      capsule: null,
      violations: zodIssuesToViolations(capsuleId, parsed.error).map((violation) => ({
        ...violation,
        rule: 'CAPSULE_SCHEMA_INVALID',
      })),
    };
  }

  return {
    capsule: parsed.data as CapsuleDefinition,
    violations: [],
  };
}

export function resolveCapabilityId(atom: AtomDefinition): string | undefined {
  return atom.capability_id ?? atom.locs_capsule?.capability_id;
}

export function classifyCapabilityLevel(atom: AtomDefinition): CapabilityLevel {
  if (atom.locs_level === 2 || Boolean(atom.locs_module_ref)) {
    return 2;
  }
  if (atom.locs_level === 1 || Boolean(atom.locs_capsule)) {
    return 1;
  }
  return 0;
}

function getProfile(atom: AtomDefinition): LocsCapsuleProfile | undefined {
  return atom.locs_capsule;
}

export function validateLocsCapsuleProfile(atom: AtomDefinition): ContractValidationResult {
  const violations: ValidationViolation[] = [];
  const warnings: ValidationViolation[] = [];
  const profile = getProfile(atom);
  const capabilityLevel = classifyCapabilityLevel(atom);

  if (atom.locs_level === 0 && profile) {
    violations.push(
      makeViolation(
        atom.id,
        'LEVEL0_CANNOT_HAVE_LOCS_CAPSULE',
        'locs_level 0 cannot be combined with locs_capsule metadata.',
        'Raise locs_level to 1 or remove locs_capsule.',
      ),
    );
  }

  if (!profile) {
    if (atom.locs_level === 1) {
      violations.push(
        makeViolation(
          atom.id,
          'LEVEL1_REQUIRES_LOCS_CAPSULE',
          'locs_level 1 atom must declare locs_capsule metadata.',
          'Add locs_capsule or lower locs_level to 0.',
        ),
      );
    }
    if (capabilityLevel === 2) {
      violations.push(
        makeViolation(
          atom.id,
          'LEVEL2_REQUIRES_LOCS_CAPSULE',
          'Level 2 atom must declare locs_capsule metadata in addition to locs_module_ref.',
          'Add locs_capsule and locs_module_ref for Level 2 atoms.',
        ),
      );
    }
    return { atom_id: atom.id, valid: violations.length === 0, violations, warnings };
  }

  if (atom.capability_id && atom.capability_id !== profile.capability_id) {
    violations.push(
      makeViolation(
        atom.id,
        'CAPABILITY_ID_MISMATCH',
        `top-level capability_id "${atom.capability_id}" must match locs_capsule.capability_id "${profile.capability_id}"`,
        'Keep one canonical capability identifier across the atom and locs_capsule.',
      ),
    );
  }

  if (profile.temporal_tracking && (!profile.temporal_scope || profile.temporal_scope.length === 0)) {
    warnings.push(
      makeViolation(
        atom.id,
        'TEMPORAL_SCOPE_MISSING',
        'temporal_tracking is enabled without temporal_scope values.',
        'Add one or more temporal_scope values or disable temporal_tracking.',
        'warning',
      ),
    );
  }

  if (capabilityLevel === 2 && !atom.locs_module_ref) {
    violations.push(
      makeViolation(
        atom.id,
        'LEVEL2_REQUIRES_MODULE_REF',
        'Level 2 atom must declare locs_module_ref.',
        'Add locs_module_ref pointing to the full LOCS module backing this atom.',
      ),
    );
  }

  return {
    atom_id: atom.id,
    valid: violations.length === 0,
    violations,
    warnings,
  };
}

export function validateGovernanceRules(
  atom: AtomDefinition,
  allAtoms: Map<string, AtomDefinition>,
): ContractValidationResult {
  const violations: ValidationViolation[] = [];
  const warnings: ValidationViolation[] = [];
  const profile = getProfile(atom);
  const capabilityId = resolveCapabilityId(atom);
  const isCapabilityAware = Boolean(capabilityId || profile);
  const isExecutable = (atom.hooks?.length ?? 0) > 0;

  if (profile && isExecutable && !profile.approval_policy) {
    violations.push(
      makeViolation(
        atom.id,
        'EXECUTABLE_REQUIRES_APPROVAL_POLICY',
        'Executable capability atom must declare approval_policy.',
        'Add locs_capsule.approval_policy to the atom contract.',
      ),
    );
  }

  if (profile && (profile.risk_level === 'high' || profile.risk_level === 'critical') && !profile.audit_level) {
    violations.push(
      makeViolation(
        atom.id,
        'HIGH_RISK_REQUIRES_AUDIT_LEVEL',
        'High-risk capability atom must declare audit_level.',
        'Add locs_capsule.audit_level to the atom contract.',
      ),
    );
  }

  if (profile && profile.swappable_atom_group && !capabilityId) {
    violations.push(
      makeViolation(
        atom.id,
        'SWAPPABLE_REQUIRES_CAPABILITY_ID',
        'Swappable atom must have a capability_id.',
        'Add a stable capability_id at the top level or inside locs_capsule.',
      ),
    );
  }

  for (const dependency of atom.dependencies ?? []) {
    if (!allAtoms.has(dependency)) {
      violations.push(
        makeViolation(
          atom.id,
          'UNRESOLVED_DEPENDENCY',
          `Declared dependency not found: ${dependency}`,
          `Ensure atom "${dependency}" exists or remove it from dependencies.`,
        ),
      );
    }
  }

  if (profile) {
    const sideEffectRiskMap: Record<LocsCapsuleProfile['side_effects'], RiskLevel> = {
      none: 'low',
      'read-only': 'low',
      explicit: 'medium',
      implicit: 'high',
    };

    const impliedRisk = sideEffectRiskMap[profile.side_effects];
    if (RISK_HIERARCHY[profile.risk_level] < RISK_HIERARCHY[impliedRisk]) {
      violations.push(
        makeViolation(
          atom.id,
          'RISK_LEVEL_CONFLICTS_WITH_SIDE_EFFECTS',
          `risk_level "${profile.risk_level}" is lower than the minimum implied by side_effects "${profile.side_effects}"`,
          `Raise risk_level to at least "${impliedRisk}" or correct the declared side_effects.`,
        ),
      );
    }
  }

  if (isCapabilityAware && !profile) {
    warnings.push(
      makeViolation(
        atom.id,
        'CAPABILITY_WITHOUT_LEVEL1_PROFILE',
        'Atom declares capability routing without a LOCS-Capsule Level 1 profile.',
        'Add locs_capsule for richer governance, compatibility, and evidence checks.',
        'warning',
      ),
    );
  }

  if (atom.locs_level === 2 && !capabilityId) {
    violations.push(
      makeViolation(
        atom.id,
        'LEVEL2_REQUIRES_CAPABILITY_ID',
        'Level 2 atom must have a capability_id.',
        'Add a stable capability_id for Level 2 atoms.',
      ),
    );
  }

  return {
    atom_id: atom.id,
    valid: violations.length === 0,
    violations,
    warnings,
  };
}

export function validateAtomAgainstAllRules(
  atom: AtomDefinition,
  allAtoms: Map<string, AtomDefinition>,
): ContractValidationResult {
  const profileValidation = validateLocsCapsuleProfile(atom);
  const governanceValidation = validateGovernanceRules(atom, allAtoms);

  return {
    atom_id: atom.id,
    valid: profileValidation.valid && governanceValidation.valid,
    violations: [...profileValidation.violations, ...governanceValidation.violations],
    warnings: [...profileValidation.warnings, ...governanceValidation.warnings],
  };
}

export function validateAllAtoms(atoms: AtomDefinition[]): ContractValidationResult[] {
  const atomMap = new Map(atoms.map((atom) => [atom.id, atom]));
  return atoms.map((atom) => validateAtomAgainstAllRules(atom, atomMap));
}

export function buildAtomCompatibilityIndex(atoms: AtomDefinition[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const atom of atoms) {
    for (const compat of atom.locs_capsule?.compatibility ?? []) {
      const existing = index.get(compat) ?? [];
      existing.push(atom.id);
      index.set(compat, Array.from(new Set(existing)).sort());
    }
  }

  return index;
}

export function buildCapabilityIdIndex(atoms: AtomDefinition[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const atom of atoms) {
    const capabilityId = resolveCapabilityId(atom);
    if (!capabilityId) {
      continue;
    }
    const existing = index.get(capabilityId) ?? [];
    existing.push(atom.id);
    index.set(capabilityId, Array.from(new Set(existing)).sort());
  }

  return index;
}

export function buildSwappableGroupIndex(atoms: AtomDefinition[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const atom of atoms) {
    const group = atom.locs_capsule?.swappable_atom_group;
    if (!group) {
      continue;
    }
    const existing = index.get(group) ?? [];
    existing.push(atom.id);
    index.set(group, Array.from(new Set(existing)).sort());
  }

  return index;
}
