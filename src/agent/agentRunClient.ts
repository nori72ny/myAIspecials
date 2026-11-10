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

/**
 * Drives a recorded run with bounded advance calls (wiring design
 * §4.5/§4.6). A 202 'held' outcome means the quota gate parked the run:
 * driving stops and the board's resume flow owns it from there (§8).
 * Other 202s (progress, writer-lock contention, a busy driver) are
 * transient and the loop keeps driving within its caps. The browser
 * binding proves ownership with the plan token in the body; the
 * operator binding proves it with the Bearer header instead.
 */
export async function driveAgentRun(runId: string, auth: AgentRunAuth, signal: AbortSignal): Promise<AgentRunDriveOutcome> {
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
      body: JSON.stringify(auth.kind === 'browser' ? { planToken: auth.planToken } : {}),
      signal,
    });
    if (response.status === 503) return { kind: 'store_unavailable' };
    const data = await response.json().catch(() => ({})) as AgentRunResponse;
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
