/** Only the latest acknowledged Direct Touch revision may unlock a PWA update.
 * Capture the marker with the exact IndexedDB snapshot and compare it again
 * after the asynchronous write succeeds. A new keystroke invalidates old saves.
 */
export function directTouchRevisionDurablySaved(
  capturedMarker: string | undefined,
  currentMarker: string | undefined,
  artifacts: readonly { revisions?: readonly { id: string }[] }[],
  storageResult: string,
): boolean {
  if (storageResult !== 'saved' || typeof capturedMarker !== 'string'
    || capturedMarker !== currentMarker || !capturedMarker.startsWith('commit:')) return false;
  const revisionId = capturedMarker.slice('commit:'.length);
  if (!revisionId || revisionId.length > 320) return false;
  return artifacts.some(artifact => artifact.revisions?.at(-1)?.id === revisionId);
}
