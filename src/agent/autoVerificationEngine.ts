import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

export type VerificationIssue = 'empty' | 'malformed' | 'syntax' | 'too_large' | 'unavailable';

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

function detectIssues(artifact: string, toolName: ToolName): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const value = artifact.trim();
  if (!value && toolName !== 'file_reader') issues.push('empty');
  if (artifact.length > MAX_ARTIFACT_CHARS) issues.push('too_large');
  if (toolName === 'code_interpreter') issues.push('unavailable');
  // Reading source text must not reinterpret its syntax or rewrite its contents.
  if (toolName === 'file_reader') return issues;
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

/**
 * Structural preflight only, not task-level or semantic quality certification.
 * Never fabricate a replacement, truncate output, or repeat a write operation.
 * Recovery requires a successful read-only tool rerun with an intact artifact.
 */
export async function verifyAndSelfFixArtifact(
  artifact: string,
  toolName: ToolName,
  rerun?: ArtifactRunner,
  params: ToolParams = {},
): Promise<VerificationResult> {
  if (typeof artifact !== 'string') return { ok: false, artifact: '', attempts: 0, selfFixed: false, issues: ['malformed'], diagnosis: 'Artifact is not a string.' };
  let current = artifact;
  let issues = detectIssues(current, toolName);
  if (toolName === 'document_generator' && typeof params.content === 'string' && current.trim() === params.content.trim()) issues.push('malformed');
  if (!issues.length) return { ok: true, artifact: current, attempts: 0, selfFixed: false, issues: [], diagnosis: 'Artifact passed structural preflight; task-level quality is not certified.' };

  const canRetry = toolName === 'repository_explorer' || toolName === 'file_reader';
  let attempts = 0;
  if (rerun && canRetry && !issues.includes('too_large')) {
    for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      try {
        const result = await rerun(toolName, params);
        if (!result.ok || result.tool !== toolName || typeof result.artifact !== 'string') continue;
        current = result.artifact;
        issues = detectIssues(current, toolName);
        if (!issues.length) return { ok: true, artifact: current, attempts, selfFixed: true, issues: [], diagnosis: 'A successful read-only rerun passed structural preflight.' };
        if (issues.includes('too_large')) break;
      } catch {
        // Failed execution is not evidence of recovery.
      }
    }
  }
  return {
    ok: false,
    artifact: current,
    attempts,
    selfFixed: false,
    issues,
    diagnosis: `Artifact verification failed closed: ${issues.join(', ')}.`,
  };
}
