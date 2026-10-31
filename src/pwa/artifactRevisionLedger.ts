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
// Keep persisted history within the same finite-size envelope as hydration.
export const ORIGIN_ARTIFACT_HISTORY_CHAR_BUDGET = 10_000_000;
export const ORIGIN_ARTIFACT_REVISION_CHAR_LIMIT = 1_000_000;

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
  // Both the number of entries AND their aggregate content size must agree
  // with the durable hydration validator. Otherwise a long editing session
  // would save a ledger that the next launch silently discards in full.
  const bounded = [...history.slice(-(ORIGIN_ARTIFACT_HISTORY_LIMIT - 1)), latest];
  const retained: OriginArtifactRevisionEntry[] = [];
  let chars = 0;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    const entry = bounded[index];
    if (entry.content.length > ORIGIN_ARTIFACT_REVISION_CHAR_LIMIT
      || chars + entry.content.length > ORIGIN_ARTIFACT_HISTORY_CHAR_BUDGET) break;
    retained.push(entry);
    chars += entry.content.length;
  }
  retained.reverse();
  return {
    revision,
    // An oversized current artifact is still passed through unchanged; only
    // its unpersistable undo ledger is omitted instead of being truncated.
    revisions: retained,
    latest,
  };
}
