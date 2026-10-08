/**
 * Rehydrate durable artifact revision history after a PWA reload.
 * Stored IndexedDB values are untrusted and may predate this schema.
 * Invalid or excessive histories are dropped, never executed.
 */
import { ORIGIN_ARTIFACT_HISTORY_LIMIT, ORIGIN_ARTIFACT_HISTORY_CHAR_BUDGET, ORIGIN_ARTIFACT_REVISION_CHAR_LIMIT } from './artifactRevisionLedger';

export type RecoveredArtifactRevision = {
  id: string;
  content: string;
  createdAt: number;
  source: 'generated' | 'direct-touch' | 'restore';
};

export function recoverPersistedArtifactRevisions(
  stored: unknown,
  currentContent: string,
): readonly RecoveredArtifactRevision[] | undefined {
  if (!Array.isArray(stored) || stored.length === 0) return undefined;
  let size = 0;
  const ids = new Set<string>();
  const revisions: RecoveredArtifactRevision[] = [];
  // Prefer the most recent contiguous suffix within both count and size
  // budgets. Legacy oversized journals should not lose ALL undo history.
  const newest = stored.slice(-ORIGIN_ARTIFACT_HISTORY_LIMIT).reverse();
  for (const item of newest) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 160
      || ids.has(value.id)
      || typeof value.content !== 'string'
      || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0
      || (value.source !== 'generated' && value.source !== 'direct-touch' && value.source !== 'restore')) {
      return undefined;
    }
    if (value.content.length > ORIGIN_ARTIFACT_REVISION_CHAR_LIMIT) {
      // The newest version must be valid; older unpersistable versions can
      // simply be excluded from a continuous retained suffix.
      if (revisions.length === 0) return undefined;
      break;
    }
    if (size + value.content.length > ORIGIN_ARTIFACT_HISTORY_CHAR_BUDGET) break;
    size += value.content.length;
    ids.add(value.id);
    revisions.unshift({
      id: value.id,
      content: value.content,
      createdAt: value.createdAt,
      source: value.source,
    });
  }
  // The final saved version must be identical to the artifact currently shown.
  // A stale or torn revision history must never replace newer document content.
  if (revisions.at(-1)?.content !== currentContent) return undefined;
  return revisions;
}
