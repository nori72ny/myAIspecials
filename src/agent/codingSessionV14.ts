import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { applyDeltaEdit, validateDeltaEdit, type DeltaEditProposal } from './safeDeltaEditor.js';
import { listRepository, readRepositoryFile } from './safeRepositoryReader.js';
import { createRepositoryFileIfAbsent } from './safeRepositoryWriter.js';
import { containsLikelySecret } from './safeFilePolicy.js';
import { normalizeCodingContextPathV14, normalizeCodingMutablePathV14 } from './codingPathPolicyV14.js';
import type { VerificationKind } from './verificationRunner.js';
import { sanitizePreEgress } from '../services/securitySanitizer.js';

const CHECKS: readonly VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];
const MAX_SCOPE_PATHS = 12;
const MAX_CREATE_PATHS = 4;
const MAX_BYTES = 256 * 1024;
const activeRoots = new Set<string>();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export type CodingSessionRequest = {
  goal: string;
  root: string;
  /** Existing mutable files. Omit to allow bounded model-assisted repository discovery. */
  allowedPaths?: string[];
  /** Read-only context, such as tests, callers and root manifests; never eligible for editing. */
  contextPaths?: string[];
  /** Approved paths that do not exist yet and may be created during this session. */
  creatablePaths?: string[];
  /** This API is for a trusted local worker, never an HTTP request body. */
  trustedWorkspaceApproved: true;
  maxRepairs?: number;
};
export type CodingCheck = { kind: VerificationKind; ok: boolean; exitCode: number | null; timedOut: boolean; diagnostic?: string };
export type CodingCreateProposal = { path: string; content: string };
export type CodingProposalBatch = { edits: DeltaEditProposal[]; creates: CodingCreateProposal[] };
export type CodingDiscoveryContext = { goal: string; files: readonly string[] };
export type CodingDiscoveredScope = { editablePaths: string[]; contextPaths: string[]; creatablePaths: string[] };
export type CodingContext = {
  goal: string;
  files: ReadonlyArray<{ path: string; content: string; sha256: string }>;
  attempt: number;
  failedChecks: VerificationKind[];
  editablePaths?: readonly string[];
  creatablePaths?: readonly string[];
  diagnostics?: ReadonlyArray<{ kind: VerificationKind; text: string }>;
};
export type CodingSessionDependencies = {
  /** Optional trusted discovery adapter. Required only when request.allowedPaths is omitted. */
  discover?: (context: CodingDiscoveryContext) => Promise<CodingDiscoveredScope>;
  /** Trusted worker supplies a planner. This module performs no provider calls. */
  propose: (context: CodingContext) => Promise<DeltaEditProposal[] | CodingProposalBatch>;
  /** Must execute real checks in the worker's approved execution environment. */
  verify: (root: string) => Promise<CodingCheck[]>;
};
export type CodingAuditEvent = {
  sequence: number;
  action: 'discovered' | 'inspected' | 'edited' | 'verified' | 'stopped';
  attempt: number;
  paths?: string[];
  changes?: Array<{ path: string; beforeSha256: string | null; afterSha256: string }>;
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
function mutablePath(value: unknown): string { try { return normalizeCodingMutablePathV14(value); } catch { return stop('CODING_PATH_BLOCKED'); } }
function contextPath(value: unknown): string { try { return normalizeCodingContextPathV14(value); } catch { return stop('CODING_PATH_BLOCKED'); } }

function normalizeProposal(value: DeltaEditProposal[] | CodingProposalBatch): CodingProposalBatch {
  if (Array.isArray(value)) return { edits: value, creates: [] };
  if (!value || typeof value !== 'object' || !Array.isArray(value.edits) || !Array.isArray(value.creates)) stop('CODING_INVALID_PATCH');
  return value;
}

async function assertCreationTargetAbsent(root: string, filePath: string): Promise<void> {
  try {
    await readRepositoryFile(root, filePath);
    stop('CODING_CREATE_TARGET_EXISTS');
  } catch (error) {
    if (error instanceof CodingBlocked) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (error instanceof Error && error.message === 'NOT_A_FILE') stop('CODING_CREATE_TARGET_EXISTS');
    throw error;
  }
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
    const goal = request.goal.trim();
    const maxRepairs = request.maxRepairs ?? 2;
    if (!Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 3) stop('CODING_REPAIR_BUDGET_BLOCKED');
    root = await realpath(request.root);
    if (root === path.parse(root).root || root === await realpath(process.cwd())) stop('CODING_DEDICATED_WORKSPACE_REQUIRED');
    if (activeRoots.has(root)) stop('CODING_WORKSPACE_BUSY');
    activeRoots.add(root);
    locked = true;

    let allowedInput = request.allowedPaths;
    let contextInput = request.contextPaths ?? [];
    let creatableInput = request.creatablePaths ?? [];
    if (allowedInput === undefined) {
      if (!deps.discover) stop('CODING_DISCOVERY_UNAVAILABLE');
      const inventory = (await listRepository(root)).filter(entry => entry.type === 'file').map(entry => entry.path);
      const discovered = await deps.discover({ goal, files: inventory });
      if (!discovered || typeof discovered !== 'object') stop('CODING_DISCOVERY_INVALID');
      allowedInput = discovered.editablePaths;
      contextInput = discovered.contextPaths;
      creatableInput = discovered.creatablePaths;
      if (!Array.isArray(allowedInput) || !Array.isArray(contextInput) || !Array.isArray(creatableInput)) stop('CODING_DISCOVERY_INVALID');
      const inventorySet = new Set(inventory);
      if (allowedInput.some(value => typeof value !== 'string' || !inventorySet.has(value)) || contextInput.some(value => typeof value !== 'string' || !inventorySet.has(value)) || creatableInput.some(value => typeof value !== 'string' || inventorySet.has(value))) stop('CODING_DISCOVERY_INVALID');
    }

    if (!Array.isArray(allowedInput) || !Array.isArray(contextInput) || !Array.isArray(creatableInput)) stop('CODING_SCOPE_BLOCKED');
    if (allowedInput.length > MAX_SCOPE_PATHS || contextInput.length > MAX_SCOPE_PATHS || creatableInput.length > MAX_CREATE_PATHS) stop('CODING_SCOPE_BLOCKED');
    const allowed = allowedInput.map(mutablePath);
    const contextPaths = contextInput.map(contextPath);
    const creatable = creatableInput.map(mutablePath);
    if (!allowed.length && !creatable.length) stop('CODING_SCOPE_BLOCKED');
    if (allowed.length + contextPaths.length + creatable.length > MAX_SCOPE_PATHS) stop('CODING_SCOPE_BLOCKED');
    const allScope = [...allowed, ...contextPaths, ...creatable];
    if (new Set(allScope).size !== allScope.length) stop('CODING_DUPLICATE_PATH');
    if (request.allowedPaths === undefined) record({ action: 'discovered', attempt: 0, paths: allScope });

    const seenProposals = new Set<string>();
    const createdPaths = new Set<string>();
    let failedChecks: VerificationKind[] = [];
    let diagnostics: Array<{ kind: VerificationKind; text: string }> = [];

    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      result.repairRounds = attempt;
      const inspected = [...allowed, ...contextPaths, ...createdPaths];
      const files: CodingContext['files'][number][] = [];
      let bytes = 0;
      for (const filePath of inspected) {
        const content = await readRepositoryFile(root, filePath);
        bytes += Buffer.byteLength(content);
        if (bytes > MAX_BYTES) stop('CODING_CONTEXT_LIMIT');
        if (containsLikelySecret(content)) stop('CODING_SENSITIVE_CONTEXT_BLOCKED');
        files.push({ path: filePath, content, sha256: digest(content) });
      }
      record({ action: 'inspected', attempt, paths: inspected });
      const editableNow = [...allowed, ...createdPaths];
      const creatableNow = creatable.filter(filePath => !createdPaths.has(filePath));
      const proposals = normalizeProposal(await deps.propose({ goal, files, attempt, failedChecks, editablePaths: editableNow, creatablePaths: creatableNow, diagnostics }));
      if (proposals.edits.length + proposals.creates.length < 1 || proposals.edits.length + proposals.creates.length > MAX_SCOPE_PATHS || proposals.creates.length > MAX_CREATE_PATHS) stop('CODING_EMPTY_OR_OVERSIZED_PATCH');
      const paths = new Set<string>();
      let patchBytes = 0;
      for (const proposal of proposals.edits) {
        if (!proposal || typeof proposal !== 'object' || typeof proposal.search !== 'string' || typeof proposal.replacement !== 'string') stop('CODING_INVALID_PATCH');
        const filePath = mutablePath(proposal.path);
        if (!editableNow.includes(filePath)) stop('CODING_OUT_OF_SCOPE');
        if (paths.has(filePath)) stop('CODING_DUPLICATE_PATH');
        paths.add(filePath);
        patchBytes += Buffer.byteLength(proposal.search) + Buffer.byteLength(proposal.replacement);
        if (patchBytes > MAX_BYTES) stop('CODING_PATCH_LIMIT');
        if (!proposal.search || proposal.search === proposal.replacement) stop('CODING_NO_CHANGE');
      }
      for (const proposal of proposals.creates) {
        if (!proposal || typeof proposal !== 'object' || typeof proposal.content !== 'string') stop('CODING_INVALID_PATCH');
        const filePath = mutablePath(proposal.path);
        if (!creatableNow.includes(filePath)) stop('CODING_OUT_OF_SCOPE');
        if (paths.has(filePath)) stop('CODING_DUPLICATE_PATH');
        paths.add(filePath);
        patchBytes += Buffer.byteLength(proposal.content);
        if (patchBytes > MAX_BYTES) stop('CODING_PATCH_LIMIT');
        if (containsLikelySecret(proposal.content)) stop('CODING_SENSITIVE_PATCH_BLOCKED');
      }
      const fingerprint = digest(JSON.stringify({
        edits: [...proposals.edits].sort((a, b) => a.path.localeCompare(b.path)),
        creates: [...proposals.creates].sort((a, b) => a.path.localeCompare(b.path)),
      }));
      if (seenProposals.has(fingerprint)) stop('CODING_REPEATED_PATCH');
      seenProposals.add(fingerprint);

      // Preflight every mutation before the first write. OS races can still produce
      // a partial batch, which remains visible in the audit rather than overwriting
      // concurrent work or claiming rollback that did not happen.
      const edits = [];
      for (const proposal of proposals.edits) {
        const edit = await validateDeltaEdit(root, proposal);
        if (digest(edit.previous) !== files.find(file => file.path === edit.path)?.sha256) stop('CODING_SNAPSHOT_CHANGED');
        if (containsLikelySecret(edit.next)) stop('CODING_SENSITIVE_PATCH_BLOCKED');
        edits.push(edit);
      }
      for (const proposal of proposals.creates) await assertCreationTargetAbsent(root, proposal.path);

      for (const edit of edits) {
        await applyDeltaEdit(root, edit);
        if (!result.changedPaths.includes(edit.path)) result.changedPaths.push(edit.path);
        record({ action: 'edited', attempt, changes: [{ path: edit.path, beforeSha256: digest(edit.previous), afterSha256: digest(edit.next) }] });
      }
      for (const proposal of proposals.creates) {
        try {
          await createRepositoryFileIfAbsent(root, proposal.path, proposal.content);
        } catch (error) {
          if (error instanceof Error && error.message === 'FILE_ALREADY_EXISTS') stop('CODING_CREATE_TARGET_CHANGED');
          throw error;
        }
        createdPaths.add(proposal.path);
        if (!result.changedPaths.includes(proposal.path)) result.changedPaths.push(proposal.path);
        record({ action: 'edited', attempt, changes: [{ path: proposal.path, beforeSha256: null, afterSha256: digest(proposal.content) }] });
      }

      const checks = await deps.verify(root);
      if (!Array.isArray(checks) || checks.length !== CHECKS.length || checks.some(check => !check || typeof check.ok !== 'boolean' || typeof check.timedOut !== 'boolean' || !(check.exitCode === null || Number.isInteger(check.exitCode))) || CHECKS.some(kind => checks.filter(check => check.kind === kind).length !== 1)) stop('CODING_VERIFICATION_INCOMPLETE');
      // Do not retain runner output, commands or thrown messages in the audit.
      const summaries = checks.map(check => ({ kind: check.kind, ok: check.ok === true, exitCode: check.exitCode, timedOut: check.timedOut !== false }));
      record({ action: 'verified', attempt, checks: summaries });
      const expected = new Map(files.map(file => [file.path, file.content]));
      for (const edit of edits) expected.set(edit.path, edit.next);
      for (const proposal of proposals.creates) expected.set(proposal.path, proposal.content);
      for (const [filePath, expectedContent] of expected) {
        if (digest(await readRepositoryFile(root, filePath)) !== digest(expectedContent)) stop('CODING_WORKSPACE_CHANGED_DURING_CHECKS');
      }
      failedChecks = summaries.filter(check => !check.ok || check.exitCode !== 0 || check.timedOut).map(check => check.kind);
      diagnostics = checks.filter(check => failedChecks.includes(check.kind)).map(check => ({
        kind: check.kind,
        // Sanitize before truncation to avoid retaining a partial credential.
        text: typeof check.diagnostic === 'string' && check.diagnostic.length <= 65536
          ? sanitizePreEgress(check.diagnostic).replaceAll(root, '[workspace]').slice(0, 4096)
          : 'Diagnostic unavailable or exceeded limit.',
      }));
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
