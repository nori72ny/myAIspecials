/**
 * Deterministic location conversion (M-3, rerun diagnosis
 * AGENT_RERUN_20261127_DIAGNOSIS_2026-11-27 §3.2): the analyzer's
 * value table cites positions in the chunk frame it was shown —
 * `チャンク N・行 M` — while the task contract (and every audit
 * reader) wants a document name and a page number. The model
 * wrote the final report's locations freehand and produced
 * chunk/line citations the successor scored 0/20; this layer
 * converts them deterministically from the view's own chunks,
 * never by asking a model.
 *
 * The page-labeled texts carry their page boundaries inline as
 * `=== Page N ===` marker lines, and the chunker preserves them
 * inside the chunk texts. A chunk/line location resolves to the
 * page in force at that line: the last marker at or before it,
 * carried across the file's chunks in index order (a chunk that
 * starts mid-page inherits the page its predecessor ended on).
 * The conversion is faithful to the recorded line — it never
 * re-anchors a value to a different occurrence.
 *
 * Anything that cannot be converted — a location already in
 * `Page N` form, free text, a chunk/line pair whose file carries
 * no page marker at or before it — is returned unchanged: the
 * layer never invents a page. Because the whole table passes
 * through this one conversion at the final analyzer step, the
 * candidates and pickups computed from it all carry the same
 * form; no side of a pair keeps the chunk form while the other
 * is converted.
 */

import type { AgentDataChunk } from './agentAttachmentData.js';

const CHUNK_LINE_LOCATION = /^チャンク\s*(\d+)\s*・\s*行\s*(\d+)$/;
const PAGE_MARKER_LINE = /^===\s*Page\s+(\d+)\s*===$/;

/** Per-chunk page facts, computed once per view: the page in
 * force when the chunk starts (carried from the file's earlier
 * chunks) and the marker positions inside the chunk text. */
type ChunkPageFacts = {
  startPage?: number;
  /** (1-based line number within the chunk text, page) pairs,
   * in line order. */
  markers: { line: number; page: number }[];
};

/**
 * Builds the location resolver for one attachment view. The
 * returned function maps a `チャンク N・行 M` location (1-based,
 * the frame the analyzer cites) to `Page P`; every other input
 * is returned unchanged.
 */
export function createAgentLocationPageResolver(
  chunks: readonly AgentDataChunk[],
): (location: string) => string {
  const factsByIndex = new Map<number, ChunkPageFacts>();
  const chunksByFile = new Map<string, AgentDataChunk[]>();
  for (const chunk of chunks) {
    const list = chunksByFile.get(chunk.fileName);
    if (list) list.push(chunk);
    else chunksByFile.set(chunk.fileName, [chunk]);
  }
  for (const fileChunks of chunksByFile.values()) {
    let pageInForce: number | undefined;
    for (const chunk of [...fileChunks].sort((a, b) => a.index - b.index)) {
      const markers: { line: number; page: number }[] = [];
      const lines = chunk.text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const marker = PAGE_MARKER_LINE.exec(lines[i].trim());
        if (marker) markers.push({ line: i + 1, page: Number(marker[1]) });
      }
      factsByIndex.set(chunk.index, { startPage: pageInForce, markers });
      if (markers.length > 0) pageInForce = markers[markers.length - 1].page;
    }
  }
  return (location: string): string => {
    const match = CHUNK_LINE_LOCATION.exec(location.trim());
    if (!match) return location;
    const facts = factsByIndex.get(Number(match[1]) - 1);
    if (!facts) return location;
    const line = Number(match[2]);
    let page = facts.startPage;
    for (const marker of facts.markers) {
      if (marker.line > line) break;
      page = marker.page;
    }
    return page !== undefined ? `Page ${page}` : location;
  };
}
