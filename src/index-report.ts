import * as fs from 'fs';
import * as path from 'path';
import {
  ArtifactRecord,
  AtomDefinition,
  AtomGovernanceMetrics,
  CapsuleDefinition,
  GovernanceReport,
  HookDefinition,
  OutcomeRecord,
} from './types';

function atomRisk(atom: AtomDefinition): string {
  return atom.activation?.risk_min ?? 'low';
}

function atomMode(atom: AtomDefinition): string {
  return atom.activation_mode ?? 'activate';
}

function buildAtomCapsuleMap(capsules: CapsuleDefinition[]): Record<string, string[]> {
  const atomCapsuleMap: Record<string, string[]> = {};
  for (const capsule of capsules) {
    for (const atomId of capsule.atoms || []) {
      if (!atomCapsuleMap[atomId]) {
        atomCapsuleMap[atomId] = [];
      }
      atomCapsuleMap[atomId].push(capsule.id);
    }
  }
  return atomCapsuleMap;
}

export function buildIndexMarkdown(
  capsules: CapsuleDefinition[],
  atoms: AtomDefinition[],
  hooks: HookDefinition[],
  governanceReport: GovernanceReport,
  generatedAt = new Date().toISOString(),
): string {
  const atomCapsuleMap = buildAtomCapsuleMap(capsules);
  const lines = [
    '# Skill Capsule Index',
    '<!-- generated: true -->',
    '<!-- source: atoms/*.json capsules/*.json -->',
    '<!-- do-not-edit: true -->',
    `<!-- generated-at: ${generatedAt} -->`,
    '',
    '## Capsules',
    '',
  ];

  for (const capsule of capsules) {
    lines.push(`### ${capsule.id} (v${capsule.version})`);
    if (capsule.description) {
      lines.push(capsule.description);
    }
    lines.push(`Atoms: ${(capsule.atoms || []).join(', ')}`);
    if (capsule.default_budget) {
      lines.push(`Budget: ${capsule.default_budget}`);
    }
    lines.push('');
  }

  lines.push('## Atoms', '');
  for (const atom of atoms) {
    const inCapsules = atomCapsuleMap[atom.id];
    lines.push(`### ${atom.id} (v${atom.version})`);
    if (atom.render?.S) {
      lines.push(atom.render.S);
    }
    const keywords = atom.triggers?.keywords?.join(', ') || '';
    const taskTypes = atom.triggers?.task_types?.join(', ') || '';
    if (keywords) {
      lines.push(`Triggers: ${keywords}`);
    }
    if (taskTypes) {
      lines.push(`Task types: ${taskTypes}`);
    }
    lines.push(`Risk: ${atomRisk(atom)} | Mode: ${atomMode(atom)}`);
    if (inCapsules?.length) {
      lines.push(`Capsule: ${inCapsules.join(', ')}`);
    }
    if (atom.dependencies?.length) {
      lines.push(`Depends: ${atom.dependencies.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Hooks', '');
  for (const hook of hooks) {
    lines.push(`### ${hook.id}`);
    lines.push(`Command: \`${hook.command}\``);
    lines.push(`Permission: ${hook.permission} | Kind: ${hook.kind}`);
    lines.push('');
  }

  lines.push(
    '',
    '## Governance Metrics',
    '<!-- computed from artifact and outcome history -->',
    '',
    '| Atom | Samples | Token Efficiency | Hook Pass Rate | Activation Accept Rate |',
    '|---|---|---|---|---|',
  );

  for (const metric of governanceReport.atoms) {
    const tokenEfficiency = metric.token_efficiency !== null ? metric.token_efficiency.toFixed(2) : 'n/a';
    const hookPassRate = metric.hook_pass_rate !== null ? metric.hook_pass_rate.toFixed(2) : 'n/a';
    const activationAcceptRate =
      metric.activation_accept_rate !== null ? metric.activation_accept_rate.toFixed(2) : 'n/a';
    lines.push(
      `| ${metric.atom_id} | ${metric.sample_count} | ${tokenEfficiency} | ${hookPassRate} | ${activationAcceptRate} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export function readOutcomeRecords(outcomesDir: string): OutcomeRecord[] {
  const outcomes: OutcomeRecord[] = [];
  if (!fs.existsSync(outcomesDir)) {
    return outcomes;
  }

  for (const file of fs.readdirSync(outcomesDir).filter((entry) => entry.endsWith('.json'))) {
    try {
      const content = fs.readFileSync(path.join(outcomesDir, file), 'utf8');
      outcomes.push(JSON.parse(content) as OutcomeRecord);
    } catch {
      // Best-effort loading for reporting.
    }
  }

  return outcomes;
}

function safeReadArtifactPayload(record: ArtifactRecord): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(record.path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readAfterActionStatuses(payload: Record<string, unknown> | null): string[] {
  if (!payload) {
    return [];
  }
  const hookResults = payload.hookResults;
  if (!hookResults || typeof hookResults !== 'object') {
    return [];
  }
  const afterAction = (hookResults as { after_action?: Array<{ status?: string }> }).after_action;
  if (!Array.isArray(afterAction)) {
    return [];
  }
  return afterAction
    .map((result) => result?.status)
    .filter((status): status is string => typeof status === 'string');
}

export function computeGovernanceReport(
  atoms: AtomDefinition[],
  composeArtifacts: ArtifactRecord[],
  verifyArtifacts: ArtifactRecord[],
  outcomes: OutcomeRecord[],
  computedAt = new Date().toISOString(),
): GovernanceReport {
  const metrics: AtomGovernanceMetrics[] = atoms.map((atom) => {
    const maxCost = atom.token_estimate?.X ?? 0;
    const renderEntries: Array<{ tokenCost?: number | null }> = [];

    for (const record of composeArtifacts) {
      const payload = safeReadArtifactPayload(record);
      const entry = Array.isArray(payload?.renderPlan)
        ? payload.renderPlan.find((item) => item?.atomId === atom.id)
        : null;
      if (entry) {
        renderEntries.push(entry as { tokenCost?: number | null });
      }
    }

    const tokenEfficiency =
      renderEntries.length >= 3 && maxCost > 0
        ? parseFloat(
            (
              1 -
              renderEntries.reduce((sum, entry) => sum + (entry.tokenCost ?? 0), 0) /
                renderEntries.length /
                maxCost
            ).toFixed(3),
          )
        : null;

    const verifyForAtom = verifyArtifacts.filter((record) => record.atomId === atom.id);
    let hookPassRate: number | null = null;
    if (verifyForAtom.length >= 3) {
      let pass = 0;
      let total = 0;
      for (const record of verifyForAtom) {
        const statuses = readAfterActionStatuses(safeReadArtifactPayload(record));
        for (const status of statuses) {
          total += 1;
          if (status === 'PASS') {
            pass += 1;
          }
        }
      }
      hookPassRate = total > 0 ? parseFloat((pass / total).toFixed(3)) : null;
    }

    const atomOutcomes = outcomes.filter(
      (outcome) => outcome.atom_id === atom.id && outcome.activation_accepted !== null && outcome.activation_accepted !== undefined,
    );
    const activationAcceptRate =
      atomOutcomes.length >= 3
        ? parseFloat(
            (
              atomOutcomes.filter((outcome) => outcome.activation_accepted === true).length / atomOutcomes.length
            ).toFixed(3),
          )
        : null;

    return {
      atom_id: atom.id,
      sample_count: renderEntries.length,
      token_efficiency: tokenEfficiency,
      hook_pass_rate: hookPassRate,
      activation_accept_rate: activationAcceptRate,
      computed_at: computedAt,
    };
  });

  return {
    version: '1.0',
    computed_at: computedAt,
    atoms: metrics,
  };
}
