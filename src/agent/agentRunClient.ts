/**
 * Client for the durable agent runs API (wiring design §4), shared by
 * the agent workspace — which records the plan it just got approved
 * and drives it — and the task board, which re-drives the operator's
 * orphaned runs when the board is displayed again (design §4.5).
 *
 * Two owner bindings exist (server contract, design §2.3):
 * - browser: the run's own plan capability token, carried in request
 *   bodies with no credential header. The binding is per-plan, so it
 *   reaches only the runs of the plan currently open.
 * - operator: the operator credential as a Bearer header. The binding
 *   is the fixed operator namespace, so it reaches every operator run
 *   across plans — which is why re-driving lives on this binding.
 *
 * Nothing here persists tokens or credentials; callers hold them in
 * memory only, exactly like the approval flow itself (design §4.7).
 * Approval tokens are consumed by run creation only and are never
 * retained or reused (design §8 stays server-enforced).
 */

export type AgentRunAuth =
  | { kind: 'browser'; planToken: string }
  | { kind: 'operator'; credential: string };

export type AgentRunCreateInput = {
  runId: string;
  goal: string;
  planToken: string;
  steps: Array<{ toolName: string; params: Record<string, unknown> }>;
};

/**
 * Client-side view of a recorded run, as carried by the advance and
 * GET responses (agent live view PR-L2, design §5.1/§5.2). The server
 * passes the record's stepsState through unchanged, so each step may
 * carry the optional liveDetail the advancer recorded — timestamps for
 * every step, and for research steps the query actually run plus the
 * first sources it returned. Records written before liveDetail existed
 * simply omit it, and consumers render those steps as progress rows
 * only. Everything here is normalized defensively: the payload is
 * network data, and a malformed field must never break the workspace.
 */
export type AgentRunStepLiveSourceView = {
  title: string;
  url: string;
  domain?: string;
  excerpt?: string;
};

export type AgentRunStepLiveDetailView = {
  startedAt?: number;
  finishedAt?: number;
  query?: string;
  sources?: AgentRunStepLiveSourceView[];
};

export type AgentRunStepStateView = {
  id: string;
  status: string;
  attempts: number;
  liveDetail?: AgentRunStepLiveDetailView;
};

export type AgentRunView = {
  runId: string;
  status: string;
  goal: string;
  plan: Array<{ toolName: string; params: Record<string, unknown> }>;
  stepsState: AgentRunStepStateView[];
};

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStepLiveDetail(value: unknown): AgentRunStepLiveDetailView | undefined {
  if (!isRecordValue(value)) return undefined;
  const detail: AgentRunStepLiveDetailView = {};
  if (typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)) detail.startedAt = value.startedAt;
  if (typeof value.finishedAt === 'number' && Number.isFinite(value.finishedAt)) detail.finishedAt = value.finishedAt;
  if (typeof value.query === 'string' && value.query) detail.query = value.query;
  if (Array.isArray(value.sources)) {
    const sources: AgentRunStepLiveSourceView[] = [];
    for (const raw of value.sources) {
      if (!isRecordValue(raw) || typeof raw.title !== 'string' || typeof raw.url !== 'string') continue;
      const source: AgentRunStepLiveSourceView = { title: raw.title, url: raw.url };
      if (typeof raw.domain === 'string' && raw.domain) source.domain = raw.domain;
      if (typeof raw.excerpt === 'string' && raw.excerpt) source.excerpt = raw.excerpt;
      sources.push(source);
    }
    if (sources.length > 0) detail.sources = sources;
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
}

/**
 * Normalizes a run view payload from an advance or GET response.
 * Returns undefined when the payload is not a run view at all; missing
 * or malformed sub-fields degrade to empty defaults instead of
 * throwing, so older servers and older records keep working.
 */
export function normalizeAgentRunView(value: unknown): AgentRunView | undefined {
  if (!isRecordValue(value) || typeof value.runId !== 'string' || typeof value.status !== 'string') return undefined;
  const plan: AgentRunView['plan'] = [];
  if (Array.isArray(value.plan)) {
    for (const raw of value.plan) {
      if (!isRecordValue(raw) || typeof raw.toolName !== 'string') continue;
      plan.push({ toolName: raw.toolName, params: isRecordValue(raw.params) ? raw.params : {} });
    }
  }
  const stepsState: AgentRunStepStateView[] = [];
  if (Array.isArray(value.stepsState)) {
    for (const raw of value.stepsState) {
      if (!isRecordValue(raw) || typeof raw.id !== 'string' || typeof raw.status !== 'string') continue;
      const step: AgentRunStepStateView = {
        id: raw.id,
        status: raw.status,
        attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
      };
      const liveDetail = normalizeStepLiveDetail(raw.liveDetail);
      if (liveDetail) step.liveDetail = liveDetail;
      stepsState.push(step);
    }
  }
  return {
    runId: value.runId,
    status: value.status,
    goal: typeof value.goal === 'string' ? value.goal : '',
    plan,
    stepsState,
  };
}

export type AgentRunDriveOutcome =
  | { kind: 'completed'; artifact?: string }
  | { kind: 'held' }
  | { kind: 'recorded' }
  | { kind: 'store_unavailable' }
  | { kind: 'failed'; code?: string };

type AgentRunResponse = {
  ok?: boolean;
  code?: string;
  status?: string;
  artifact?: string;
  run?: unknown;
};

// Wiring design §4.5: a recorded run is driven with bounded advance
// calls. The caps keep a stuck or contended run from being polled
// forever; the record is durable, so stopping never loses the work —
// the task board keeps it visible and can pick it up again.
const RUN_ADVANCE_MAX_CALLS = 10;
const RUN_ADVANCE_TOTAL_LIMIT_MS = 5 * 60 * 1000;
const RUN_ADVANCE_RETRY_DELAY_MS = 1500;

function runAuthHeaders(auth: AgentRunAuth): HeadersInit {
  return auth.kind === 'operator'
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.credential}` }
    : { 'Content-Type': 'application/json' };
}

function waitForAdvanceRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, RUN_ADVANCE_RETRY_DELAY_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Records an approved plan as a durable run (wiring design §4.1). The
 * body is identical for both bindings — the server verifies the plan
 * and approval capabilities either way; the operator binding only adds
 * the Bearer header. A 503 means the run store is unavailable — the
 * caller fails closed and never falls back to the stateless /execute
 * path (design §4.6).
 */
export async function createAgentRunRecord(
  input: AgentRunCreateInput,
  approvalToken: string,
  auth: AgentRunAuth,
  signal: AbortSignal,
): Promise<'created' | 'store_unavailable'> {
  const response = await fetch('/api/agent/v3/runs', {
    method: 'POST',
    headers: runAuthHeaders(auth),
    cache: 'no-store',
    body: JSON.stringify({
      runId: input.runId,
      goal: input.goal,
      planToken: input.planToken,
      approvalToken,
      steps: input.steps,
    }),
    signal,
  });
  if (response.status === 503) return 'store_unavailable';
  const data = await response.json().catch(() => ({})) as AgentRunResponse;
  if (!response.ok || data.ok !== true) throw new Error(data.code ?? 'AGENT_RUN_CREATE_FAILED');
  return 'created';
}

export type AgentRunDriveOptions = {
  /**
   * Per-advance budget forwarded to the server. The workspace passes
   * AGENT_RUN_SMALL_ADVANCE_BUDGET_MS so each advance returns after a
   * step or two and the live panel can advance step by step (design
   * §5.1). Callers that omit it keep the server's default budget.
   */
  budgetMs?: number;
  /**
   * Called with the normalized run view of every advance response
   * that carries one (progress, completion and failure alike), in
   * response order — the live view's progress feed.
   */
  onProgress?: (run: AgentRunView) => void;
};

/**
 * The small per-advance budget the workspace drives with (agent live
 * view PR-L2, design §5.1: 8,000–15,000 ms). The drive caps above are
 * unchanged, so a long run still hands over to the task board after
 * the same bounded number of calls.
 */
export const AGENT_RUN_SMALL_ADVANCE_BUDGET_MS = 10_000;

/**
 * Drives a recorded run with bounded advance calls (wiring design
 * §4.5/§4.6). A 202 'held' outcome means the quota gate parked the run:
 * driving stops and the board's resume flow owns it from there (§8).
 * Other 202s (progress, writer-lock contention, a busy driver) are
 * transient and the loop keeps driving within its caps. The browser
 * binding proves ownership with the plan token in the body; the
 * operator binding proves it with the Bearer header instead.
 */
export async function driveAgentRun(runId: string, auth: AgentRunAuth, signal: AbortSignal, options: AgentRunDriveOptions = {}): Promise<AgentRunDriveOutcome> {
  const startedAt = Date.now();
  for (let call = 1; call <= RUN_ADVANCE_MAX_CALLS; call += 1) {
    if (call > 1) {
      if (Date.now() - startedAt >= RUN_ADVANCE_TOTAL_LIMIT_MS) return { kind: 'recorded' };
      await waitForAdvanceRetry(signal);
    }
    const response = await fetch(`/api/agent/v3/runs/${encodeURIComponent(runId)}/advance`, {
      method: 'POST',
      headers: runAuthHeaders(auth),
      cache: 'no-store',
      body: JSON.stringify({
        ...(auth.kind === 'browser' ? { planToken: auth.planToken } : {}),
        ...(options.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
      }),
      signal,
    });
    if (response.status === 503) return { kind: 'store_unavailable' };
    const data = await response.json().catch(() => ({})) as AgentRunResponse;
    // Live view (PR-L2): every advance response carries the run view;
    // hand it to the caller's progress feed before the outcome
    // branching, so the panel also reflects the final and failed
    // states, not just the in-between ones.
    const runView = normalizeAgentRunView(data.run);
    if (runView) options.onProgress?.(runView);
    if (response.status === 200 && data.ok === true && data.status === 'completed') {
      return { kind: 'completed', artifact: typeof data.artifact === 'string' ? data.artifact : undefined };
    }
    if (response.status === 202) {
      if (data.status === 'held' || data.code === 'AGENT_RUN_QUOTA_EXHAUSTED') return { kind: 'held' };
      continue;
    }
    if (response.status === 409) {
      if (data.code === 'AGENT_RUN_HELD') return { kind: 'held' };
      return { kind: 'recorded' };
    }
    if (response.status === 422) return { kind: 'failed', code: data.code };
    throw new Error(data.code ?? 'AGENT_RUN_ADVANCE_FAILED');
  }
  return { kind: 'recorded' };
}

/**
 * Reads one recorded run's current view (agent live view PR-L2,
 * design §5.1). The workspace uses it to keep the live panel current
 * after its own driving stops at the caps while the run continues —
 * the caller polls it only while the panel is on screen and the run
 * is not terminal. The browser binding authenticates with the
 * x-agent-plan-token header (the GET has no body to carry it); the
 * operator binding with the Bearer header. Any failure — including a
 * 404 for a run this binding cannot see — returns null; polling
 * simply tries again on its next tick.
 */
export async function fetchAgentRunView(runId: string, auth: AgentRunAuth, signal: AbortSignal): Promise<AgentRunView | null> {
  const response = await fetch(`/api/agent/v3/runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
    headers: auth.kind === 'operator'
      ? { Authorization: `Bearer ${auth.credential}` }
      : { 'x-agent-plan-token': auth.planToken },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({})) as AgentRunResponse;
  return normalizeAgentRunView(data.run) ?? null;
}
