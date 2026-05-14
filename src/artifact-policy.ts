import {
  ArtifactLineage,
  ArtifactQuery,
  ArtifactRecord,
  ArtifactResumePlan,
  ArtifactSummary,
  SkillCapsuleConfig,
} from './types';

export function filterArtifactRecords(records: ArtifactRecord[], query: ArtifactQuery): ArtifactRecord[] {
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

export function resolveSuccessfulArtifactStatuses(kind?: ArtifactRecord['kind']): string[] {
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

export function resolveFailureArtifactStatuses(kind?: ArtifactRecord['kind']): string[] {
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

export function summarizeArtifactRecords(records: ArtifactRecord[]): ArtifactSummary {
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

export function buildArtifactLineage(runId: string, artifacts: ArtifactRecord[]): ArtifactLineage {
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

export function determineResumeAction(
  artifact: Pick<ArtifactRecord, 'kind' | 'status'>,
): ArtifactResumePlan['recommendedAction'] {
  if (artifact.kind === 'compose') {
    return 'prepare';
  }
  if (artifact.kind === 'prepare') {
    return artifact.status === 'BLOCKED' ? 'prepare' : 'verify';
  }
  return 'verify';
}

export function computePrunedArtifactSets(
  records: ArtifactRecord[],
  retention?: SkillCapsuleConfig['artifact_retention'],
): {
  kept: ArtifactRecord[];
  removed: ArtifactRecord[];
} {
  const sorted = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
