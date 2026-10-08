/**
 * Rehydrate durable artifact revision history after a PWA reload.
 * Stored IndexedDB values are untrusted and may predate this schema.
 * Invalid or excessive histories are dropped, never executed.
 */
export type RecoveredArtifactRevision = {
  id: string;
  content: string;
  createdAt: number;
  source: 'generated' | 'direct-touch' | 'restore';
};

const MAX_REVISIONS = 64;
const MAX_CONTENT_CHARS = 1_000_000;
const MAX_HISTORY_CHARS = 10_000_000;

export function recoverPersistedArtifactRevisions(
  stored: unknown,
  currentContent: string,
): readonly RecoveredArtifactRevision[] | undefined {
  if (!Array.isArray(stored) || stored.length === 0 || stored.length > MAX_REVISIONS) return undefined;
  let size = 0;
  const ids = new Set<string>();
  const revisions: RecoveredArtifactRevision[] = [];
  for (const item of stored) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 160
      || ids.has(value.id)
      || typeof value.content !== 'string' || value.content.length > MAX_CONTENT_CHARS
      || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0
      || (value.source !== 'generated' && value.source !== 'direct-touch' && value.source !== 'restore')) {
      return undefined;
    }
    size += value.content.length;
    if (size > MAX_HISTORY_CHARS) return undefined;
    ids.add(value.id);
    revisions.push({
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
