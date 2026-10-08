/**
 * Keeps a bounded, monotonically numbered artifact revision ledger.
 * Revisions older than the UI retention window are not needed for the latest
 * edit/undo affordance, and must not make every future snapshot grow forever.
 */
export type OriginArtifactRevisionEntry = {
  id: string;
  content: string;
  createdAt: number;
  source: 'generated' | 'direct-touch' | 'restore';
};

export const ORIGIN_ARTIFACT_HISTORY_LIMIT = 64;

export function appendOriginArtifactRevision(
  artifact: {
    id: string;
    content: string;
    revision?: number;
    revisions?: readonly OriginArtifactRevisionEntry[];
  },
  content: string,
  source: 'direct-touch' | 'restore',
  createdAt: number = Date.now(),
): { revision: number; revisions: OriginArtifactRevisionEntry[]; latest: OriginArtifactRevisionEntry } {
  const history = artifact.revisions ?? [{
    id: `${artifact.id}:v1`,
    content: artifact.content,
    createdAt: 0,
    source: 'generated' as const,
  }];
  const previousNumber = /:v([1-9][0-9]*)$/.exec(history.at(-1)?.id ?? '');
  const suffix = previousNumber ? Number(previousNumber[1]) : 0;
  const reliableSuffix = Number.isSafeInteger(suffix) ? suffix : 0;
  const declaredVersion = typeof artifact.revision === 'number'
    && Number.isSafeInteger(artifact.revision) && artifact.revision >= 1 ? artifact.revision : 0;
  const revision = Math.max(1, history.length, reliableSuffix, declaredVersion) + 1;
  if (!Number.isSafeInteger(revision)) throw new Error('artifact-revision-number-exhausted');
  const latest: OriginArtifactRevisionEntry = {
    id: `${artifact.id}:v${revision}`,
    content,
    createdAt,
    source,
  };
  return {
    revision,
    revisions: [...history.slice(-(ORIGIN_ARTIFACT_HISTORY_LIMIT - 1)), latest],
    latest,
  };
}
