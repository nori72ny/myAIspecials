import { describe, expect, it, vi } from "vitest";
import { githubJson } from "./aq-final-state-github-json.mjs";

const url = "https://api.github.com/repos/owner/repo/actions/artifacts?per_page=100&page=1";
const token = "synthetic-test-token";

function harness(statuses: number[]) {
  const responses = statuses.map(status => new Response(
    status === 200 ? JSON.stringify({ artifacts: [] }) : "untrusted error body",
    { status },
  ));
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected extra request");
    return response;
  });
  const sleepImpl = vi.fn(async () => {});
  return { fetchImpl, sleepImpl };
}

describe("AQ final state GitHub metadata recovery", () => {
  it("returns first-attempt metadata without waiting", async () => {
    const io = harness([200]);
    await expect(githubJson(url, token, io)).resolves.toEqual({ artifacts: [] });
    expect(io.fetchImpl).toHaveBeenCalledTimes(1);
    expect(io.sleepImpl).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503, 504])("recovers from transient HTTP %s", async status => {
    const io = harness([status, 200]);
    await expect(githubJson(url, token, io)).resolves.toEqual({ artifacts: [] });
    expect(io.fetchImpl).toHaveBeenCalledTimes(2);
    expect(io.sleepImpl).toHaveBeenCalledExactlyOnceWith(1000);
    for (const [target, options] of io.fetchImpl.mock.calls) {
      expect(target).toBe(url);
      expect(options).toMatchObject({ method: "GET", redirect: "error" });
      expect(options?.headers).toHaveProperty("Authorization", `Bearer ${token}`);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("recovers after several transient GitHub failures with bounded backoff", async () => {
    const io = harness([500, 502, 503, 504, 200]);
    await expect(githubJson(url, token, io)).resolves.toEqual({ artifacts: [] });
    expect(io.fetchImpl).toHaveBeenCalledTimes(5);
    expect(io.sleepImpl.mock.calls).toEqual([[1000], [2000], [4000], [8000]]);
  });

  it("fails after five transient responses with bounded waits", async () => {
    const io = harness([500, 502, 503, 504, 500, 200]);
    await expect(githubJson(url, token, io)).rejects.toThrow("AQ_FINAL_STATE_GITHUB_HTTP_500");
    expect(io.fetchImpl).toHaveBeenCalledTimes(5);
    expect(io.sleepImpl.mock.calls).toEqual([[1000], [2000], [4000], [8000]]);
  });

  it.each([401, 403, 404, 429, 501])("does not retry HTTP %s", async status => {
    const io = harness([status, 200]);
    await expect(githubJson(url, token, io)).rejects.toThrow(`AQ_FINAL_STATE_GITHUB_HTTP_${status}`);
    expect(io.fetchImpl).toHaveBeenCalledTimes(1);
    expect(io.sleepImpl).not.toHaveBeenCalled();
  });

  it("does not retry malformed successful JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("invalid-json"));
    const sleepImpl = vi.fn(async () => {});
    await expect(githubJson(url, token, { fetchImpl, sleepImpl })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("does not retry transport errors or timeouts", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("transport failed"); });
    const sleepImpl = vi.fn(async () => {});
    await expect(githubJson(url, token, { fetchImpl, sleepImpl })).rejects.toThrow("transport failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});
