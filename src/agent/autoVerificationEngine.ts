import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

export type VerificationIssue = 'empty' | 'malformed' | 'syntax';

export type VerificationResult = {
  ok: boolean;
  artifact: string;
  attempts: number;
  selfFixed: boolean;
  issues: VerificationIssue[];
  diagnosis: string;
};

export type ArtifactRunner = (toolName: ToolName, params: ToolParams) => Promise<ToolResult>;

const MAX_REPAIR_ATTEMPTS = 2;
const MAX_ARTIFACT_CHARS = 120_000;

/**
 * A document envelope carrying its entity as base64 (artifact
 * retrieval R-2) is opaque to this verifier's textual checks, and
 * truncating it at MAX_ARTIFACT_CHARS would corrupt the payload it
 * exists to carry. Detection therefore runs on a probe copy with
 * the payload elided; a clean envelope is returned byte-for-byte.
 * Returns null for anything that is not such an envelope, so every
 * other artifact keeps the existing verify-and-truncate behavior.
 */
function binaryEnvelopeProbe(artifact: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.kind !== 'document' || typeof envelope.contentBase64 !== 'string') return null;
  return JSON.stringify({ ...envelope, contentBase64: '' });
}

function detectIssues(artifact: string, toolName: ToolName): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const value = artifact.trim();
  if (!value) issues.push('empty');
  if (value.includes('\u0000') || /(?:^|\n)undefined(?:$|\n)/.test(value)) issues.push('malformed');

  if (toolName === 'code_interpreter' || /(?:^|\n)```(?:typescript|javascript|ts|js)?/.test(value)) {
    const pairs = [['(', ')'], ['[', ']'], ['{', '}']] as const;
    for (const [open, close] of pairs) {
      let depth = 0;
      for (const char of value) {
        if (char === open) depth += 1;
        if (char === close) depth -= 1;
        if (depth < 0) break;
      }
      if (depth !== 0) { issues.push('syntax'); break; }
    }
  }
  return [...new Set(issues)];
}

function localRepair(artifact: string, toolName: ToolName, issues: VerificationIssue[]): string {
  if (!issues.length) return artifact.slice(0, MAX_ARTIFACT_CHARS);
  if (issues.includes('empty')) {
    return toolName === 'document_generator' ? '# Recovered Artifact\n\nNo usable content was returned.' : '// Recovered Artifact\n// No usable content was returned.';
  }
  let repaired = artifact.replace(/\u0000/g, '').replace(/\bundefined\b/g, '');
  if (issues.includes('syntax') && toolName === 'code_interpreter') {
    const pairs = [['(', ')'], ['[', ']'], ['{', '}']] as const;
    for (const [open, close] of pairs) {
      const opens = (repaired.match(new RegExp(`\\${open}`, 'g')) ?? []).length;
      const closes = (repaired.match(new RegExp(`\\${close}`, 'g')) ?? []).length;
      if (opens > closes) repaired += close.repeat(opens - closes);
    }
  }
  return repaired.slice(0, MAX_ARTIFACT_CHARS);
}

/**
 * Verifies an artifact locally and performs at most two bounded repair passes.
 * An optional runner enables a true tool re-run while keeping the public two-argument API valid.
 */
export async function verifyAndSelfFixArtifact(
  artifact: string,
  toolName: ToolName,
  rerun?: ArtifactRunner,
  params: ToolParams = {},
): Promise<VerificationResult> {
  let current = typeof artifact === 'string' ? artifact : '';
  const probe = binaryEnvelopeProbe(current);
  if (probe !== null && detectIssues(probe, toolName).length === 0) {
    return { ok: true, artifact: current, attempts: 0, selfFixed: false, issues: [], diagnosis: 'Artifact passed local verification.' };
  }
  let issues = detectIssues(current, toolName);
  if (!issues.length) return { ok: true, artifact: current.slice(0, MAX_ARTIFACT_CHARS), attempts: 0, selfFixed: false, issues: [], diagnosis: 'Artifact passed local verification.' };

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    if (rerun) {
      try {
        const rerunResult = await rerun(toolName, params);
        if (rerunResult.artifact) current = rerunResult.artifact;
      } catch {
        // Fall through to deterministic local repair; never let verification crash the agent.
      }
    }
    current = localRepair(current, toolName, issues);
    issues = detectIssues(current, toolName);
    if (!issues.length) {
      return { ok: true, artifact: current, attempts: attempt, selfFixed: true, issues: [], diagnosis: 'Artifact was repaired and passed local verification.' };
    }
  }

  return {
    ok: false,
    artifact: current,
    attempts: MAX_REPAIR_ATTEMPTS,
    selfFixed: true,
    issues,
    diagnosis: `Verification failed closed after ${MAX_REPAIR_ATTEMPTS} bounded repair attempts: ${issues.join(', ')}.`,
  };
}
