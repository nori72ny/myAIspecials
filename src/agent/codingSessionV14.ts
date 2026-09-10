import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { applyDeltaEdit, validateDeltaEdit, type DeltaEditProposal } from './safeDeltaEditor.js';
import { readRepositoryFile } from './safeRepositoryReader.js';
import { containsLikelySecret } from './safeFilePolicy.js';
import type { VerificationKind } from './verificationRunner.js';

const CHECKS: readonly VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];
const MAX_FILES = 12;
const MAX_BYTES = 256 * 1024;
const activeRoots = new Set<string>();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export type CodingSessionRequest = {
  goal: string;
  root: string;
  allowedPaths: string[];
  /** This API is for a trusted local worker, never an HTTP request body. */
  trustedWorkspaceApproved: true;
  maxRepairs?: number;
};
export type CodingCheck = { kind: VerificationKind; ok: boolean; exitCode: number | null; timedOut: boolean };
export type CodingContext = {
  goal: string;
  files: ReadonlyArray<{ path: string; content: string; sha256: string }>;
  attempt: number;
  failedChecks: VerificationKind[];
};
export type CodingSessionDependencies = {
  /** Trusted worker supplies a planner. This module performs no provider calls. */
  propose: (context: CodingContext) => Promise<DeltaEditProposal[]>;
  /** Must execute real checks in the worker's approved execution environment. */
  verify: (root: string) => Promise<CodingCheck[]>;
};
export type CodingAuditEvent = {
  sequence: number;
  action: 'inspected' | 'edited' | 'verified' | 'stopped';
  attempt: number;
  paths?: string[];
  changes?: Array<{ path: string; beforeSha256: string; afterSha256: string }>;
  checks?: CodingCheck[];
  code?: string;
};
export type CodingSessionResult = {
  runId: string;
  status: 'verified' | 'blocked' | 'repair_limit';
  code: string;
  repairRounds: number;
  changedPaths: string[];
  audit: CodingAuditEvent[];
  gitPublished: false;
  deployed: false;
};

class CodingBlocked extends Error {}
function stop(code: string): never { throw new CodingBlocked(code); }

function safePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 180 || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) stop('CODING_PATH_BLOCKED');
  const parts = value.split('/');
  if (parts.some(p => !p || p.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(p))) stop('CODING_PATH_BLOCKED');
  if (/\.(?:pem|key|p12|pfx)$/i.test(value) || ['package.json', 'package-lock.json', 'server.ts', 'vercel.json'].includes(value)) stop('CODING_PATH_BLOCKED');
  return value;
}

/**
 * One session per dedicated workspace in this worker process. Deployments and
 * Git writes deliberately require separate adapters/approval. This is not an
 * OS sandbox and must not be mounted on the production app's writable routes.
 */
export async function runCodingSessionV14(request: CodingSessionRequest, deps: CodingSessionDependencies): Promise<CodingSessionResult> {
  const result: CodingSessionResult = {
    runId: `coding-${randomUUID()}`, status: 'blocked', code: 'CODING_NOT_STARTED',
    repairRounds: 0, changedPaths: [], audit: [], gitPublished: false, deployed: false,
  };
  let root: string | undefined;
  let locked = false;
  const record = (event: Omit<CodingAuditEvent, 'sequence'>) => result.audit.push({ sequence: result.audit.length + 1, ...event });
  try {
    if (request.trustedWorkspaceApproved !== true) stop('CODING_WORKSPACE_APPROVAL_REQUIRED');
    if (typeof request.goal !== 'string' || !request.goal.trim() || request.goal.length > 4000 || containsLikelySecret(request.goal)) stop('CODING_GOAL_BLOCKED');
    if (!Array.isArray(request.allowedPaths) || !request.allowedPaths.length || request.allowedPaths.length > MAX_FILES) stop('CODING_SCOPE_BLOCKED');
    const allowed = request.allowedPaths.map(safePath);
    if (new Set(allowed).size !== allowed.length) stop('CODING_DUPLICATE_PATH');
    const maxRepairs = request.maxRepairs ?? 2;
    if (!Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 3) stop('CODING_REPAIR_BUDGET_BLOCKED');
    root = await realpath(request.root);
    if (root === path.parse(root).root || root === await realpath(process.cwd())) stop('CODING_DEDICATED_WORKSPACE_REQUIRED');
    if (activeRoots.has(root)) stop('CODING_WORKSPACE_BUSY');
    activeRoots.add(root);
    locked = true;
    const seenProposals = new Set<string>();
    let failedChecks: VerificationKind[] = [];

    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      result.repairRounds = attempt;
      const files: CodingContext['files'][number][] = [];
      let bytes = 0;
      for (const filePath of allowed) {
        const content = await readRepositoryFile(root, filePath);
        bytes += Buffer.byteLength(content);
        if (bytes > MAX_BYTES) stop('CODING_CONTEXT_LIMIT');
        if (containsLikelySecret(content)) stop('CODING_SENSITIVE_CONTEXT_BLOCKED');
        files.push({ path: filePath, content, sha256: digest(content) });
      }
      record({ action: 'inspected', attempt, paths: allowed });
      const proposals = await deps.propose({ goal: request.goal.trim(), files, attempt, failedChecks });
      if (!Array.isArray(proposals) || !proposals.length || proposals.length > MAX_FILES) stop('CODING_EMPTY_OR_OVERSIZED_PATCH');
      const paths = new Set<string>();
      let patchBytes = 0;
      for (const proposal of proposals) {
        if (!proposal || typeof proposal !== 'object' || typeof proposal.search !== 'string' || typeof proposal.replacement !== 'string') stop('CODING_INVALID_PATCH');
        const filePath = safePath(proposal.path);
        if (!allowed.includes(filePath)) stop('CODING_OUT_OF_SCOPE');
        if (paths.has(filePath)) stop('CODING_DUPLICATE_PATH');
        paths.add(filePath);
        patchBytes += Buffer.byteLength(proposal.search) + Buffer.byteLength(proposal.replacement);
        if (patchBytes > MAX_BYTES) stop('CODING_PATCH_LIMIT');
        if (proposal.search === proposal.replacement) stop('CODING_NO_CHANGE');
      }
      const fingerprint = digest(JSON.stringify([...proposals].sort((a, b) => a.path.localeCompare(b.path))));
      if (seenProposals.has(fingerprint)) stop('CODING_REPEATED_PATCH');
      seenProposals.add(fingerprint);

      // Preflight the entire batch before the first write. Files can still change
      // between writes; the writer rechecks snapshots, and partial edits remain
      // visible in the journal rather than silently overwriting later user work.
      const edits = [];
      for (const proposal of proposals) {
        const edit = await validateDeltaEdit(root, proposal);
        if (digest(edit.previous) !== files.find(f => f.path === edit.path)?.sha256) stop('CODING_SNAPSHOT_CHANGED');
        if (containsLikelySecret(edit.next)) stop('CODING_SENSITIVE_PATCH_BLOCKED');
        edits.push(edit);
      }
      for (const edit of edits) {
        await applyDeltaEdit(root, edit);
        if (!result.changedPaths.includes(edit.path)) result.changedPaths.push(edit.path);
        record({ action: 'edited', attempt, changes: [{ path: edit.path, beforeSha256: digest(edit.previous), afterSha256: digest(edit.next) }] });
      }
      const checks = await deps.verify(root);
      if (!Array.isArray(checks) || checks.length !== CHECKS.length || checks.some(c => !c || typeof c.ok !== 'boolean' || typeof c.timedOut !== 'boolean' || !(c.exitCode === null || Number.isInteger(c.exitCode))) || CHECKS.some(kind => checks.filter(c => c.kind === kind).length !== 1)) stop('CODING_VERIFICATION_INCOMPLETE');
      // Do not retain runner output, commands or thrown messages in the audit.
      const summaries = checks.map(c => ({ kind: c.kind, ok: c.ok === true, exitCode: c.exitCode, timedOut: c.timedOut !== false }));
      record({ action: 'verified', attempt, checks: summaries });
      for (const file of files) {
        const expected = edits.find(e => e.path === file.path)?.next ?? file.content;
        if (digest(await readRepositoryFile(root, file.path)) !== digest(expected)) stop('CODING_WORKSPACE_CHANGED_DURING_CHECKS');
      }
      failedChecks = summaries.filter(c => !c.ok || c.exitCode !== 0 || c.timedOut).map(c => c.kind);
      if (!failedChecks.length) {
        result.status = 'verified';
        result.code = 'CODING_CHECKS_PASSED';
        return result;
      }
    }
    result.status = 'repair_limit';
    result.code = 'CODING_REPAIR_LIMIT_REACHED';
  } catch (error) {
    result.code = error instanceof CodingBlocked ? error.message : 'CODING_OPERATION_BLOCKED';
  } finally {
    if (locked && root) activeRoots.delete(root);
  }
  record({ action: 'stopped', attempt: result.repairRounds, code: result.code });
  return result;
}
