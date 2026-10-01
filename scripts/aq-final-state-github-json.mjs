import { setTimeout as sleep } from "node:timers/promises";

const TRANSIENT_HTTP = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1_000, 2_000];

// Retry only idempotent GitHub metadata reads, never provider calls or a
// workflow/evaluation run. Authentication, quota, parsing and transport errors
// remain fail-closed; even transient HTTP errors get at most three attempts.
export async function githubJson(url, token, {
  fetchImpl = fetch,
  sleepImpl = (delay) => sleep(delay),
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response.json();

    const error = new Error(`AQ_FINAL_STATE_GITHUB_HTTP_${response.status}`);
    // Do not read or log error bodies (which may contain sensitive metadata).
    await response.body?.cancel().catch(() => {});
    if (!TRANSIENT_HTTP.has(response.status) || attempt >= RETRY_DELAYS_MS.length) {
      throw error;
    }
    await sleepImpl(RETRY_DELAYS_MS[attempt]);
  }
}
