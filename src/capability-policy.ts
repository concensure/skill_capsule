import {
  AtomDefinition,
  AtomRoutingSummary,
  AuditCheck,
  CapabilityEvolutionResult,
  TimeTraceComparisonStats,
} from './types';

export function buildSelectionTemporalContext(
  atom: Pick<AtomDefinition, 'id' | 'version'>,
  projectConstraints: string[],
): string {
  const constraints = projectConstraints.length > 0 ? projectConstraints.join(',') : 'none';
  return `selected_atom=${atom.id};version=${atom.version};constraints=${constraints}`;
}

export function determineAuditTemporalOutcome(
  valid: boolean,
  checks: AuditCheck[],
): 'approved' | 'rejected' {
  return valid && !checks.some((check) => check.status === 'FAIL') ? 'approved' : 'rejected';
}

export function buildAuditTemporalSummary(
  atom: Pick<AtomDefinition, 'id'>,
  outcome: 'approved' | 'rejected',
  checks: AuditCheck[],
): string {
  const failedChecks = checks.filter((check) => check.status === 'FAIL').map((check) => check.name);
  const warnedChecks = checks.filter((check) => check.status === 'WARN').map((check) => check.name);
  const fragments = [
    `atom=${atom.id}`,
    `outcome=${outcome}`,
    failedChecks.length > 0 ? `fail=${failedChecks.join(',')}` : 'fail=none',
    warnedChecks.length > 0 ? `warn=${warnedChecks.join(',')}` : 'warn=none',
  ];
  return fragments.join(';');
}

export function resolveAtomCapabilityId(atom: Pick<AtomDefinition, 'capability_id' | 'locs_capsule'>): string | undefined {
  return atom.capability_id ?? atom.locs_capsule?.capability_id;
}

export function resolveCapabilityTemporalMetadata(capabilityAtoms: AtomRoutingSummary[]): {
  tracked: boolean;
  scopes: string[];
} {
  const tracked = capabilityAtoms.some((atom) => atom.locs_capsule?.temporal_tracking === true);
  const scopes = Array.from(
    new Set(
      capabilityAtoms.flatMap((atom) => atom.locs_capsule?.temporal_scope ?? []),
    ),
  ).sort((left, right) => left.localeCompare(right));
  return { tracked, scopes };
}

export function evaluateCapabilityEvolution(stats: TimeTraceComparisonStats): {
  recommendation: CapabilityEvolutionResult['recommendation'];
  confidenceGate: CapabilityEvolutionResult['confidence_gate'];
  reasoning: string[];
} {
  const reasoning: string[] = [];
  let recommendation: CapabilityEvolutionResult['recommendation'] = 'stay';
  let confidenceGate: CapabilityEvolutionResult['confidence_gate'] = 'medium';

  if (stats.has_recent_rollback || stats.approval_rate < 0.4 || stats.confidence === 'unstable') {
    recommendation = 'demote';
    confidenceGate = 'high';
    reasoning.push(
      `Approval rate ${(stats.approval_rate * 100).toFixed(0)}% is below the demotion threshold or rollback risk is present.`,
    );
    if (stats.rollback_count > 0) {
      reasoning.push(`${stats.rollback_count} rollback event(s) recorded in recent history.`);
    }
    if (stats.confidence === 'unstable') {
      reasoning.push('TimeTrace marked the capability confidence as unstable.');
    }
    return { recommendation, confidenceGate, reasoning };
  }

  if (
    stats.confidence === 'stable' &&
    stats.approval_rate >= 0.8 &&
    stats.evidence_quality === 'high' &&
    stats.verified_count >= 1
  ) {
    recommendation = 'promote';
    confidenceGate = 'high';
    reasoning.push(`Approval rate ${(stats.approval_rate * 100).toFixed(0)}% with ${stats.audit_count} audit event(s).`);
    reasoning.push(`Evidence quality is ${stats.evidence_quality} and TimeTrace confidence is ${stats.confidence}.`);
    return { recommendation, confidenceGate, reasoning };
  }

  if (stats.confidence === 'watch' || stats.evidence_quality === 'medium') {
    confidenceGate = 'medium';
    reasoning.push('Capability is neither strong enough for promotion nor weak enough for demotion.');
  } else {
    confidenceGate = 'low';
    reasoning.push('Historical evidence is currently thin; defaulting to stay.');
  }
  reasoning.push(
    `Approval rate ${(stats.approval_rate * 100).toFixed(0)}%, evidence quality ${stats.evidence_quality}, confidence ${stats.confidence}.`,
  );
  return { recommendation, confidenceGate, reasoning };
}
