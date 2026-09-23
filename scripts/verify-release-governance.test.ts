import { afterEach, expect, it, vi } from "vitest";
import { verifyReleaseGovernance } from "./verify-release-governance.mjs";

afterEach(() => vi.unstubAllGlobals());

it("accepts only a protected main branch", async () => {
  const fetchMock = vi.fn(async () => Response.json({
    name: "main",
    protected: true,
    commit: { sha: "a".repeat(40) },
  }));
  await expect(verifyReleaseGovernance({
    GITHUB_REPOSITORY: "nori72ny/myAIspecials",
    GITHUB_API_URL: "https://api.github.com",
  }, fetchMock as typeof fetch)).resolves.toEqual({
    status: "passed",
    branch: "main",
    protected: true,
    sha: "a".repeat(40),
  });
});

it("fails closed when main is not protected", async () => {
  const fetchMock = vi.fn(async () => Response.json({
    name: "main",
    protected: false,
    commit: { sha: "b".repeat(40) },
  }));
  await expect(verifyReleaseGovernance({
    GITHUB_REPOSITORY: "nori72ny/myAIspecials",
  }, fetchMock as typeof fetch)).rejects.toThrow("RELEASE_GOVERNANCE_MAIN_UNPROTECTED");
});

it("does not send repository secrets in request URLs", async () => {
  const fetchMock = vi.fn(async (url: string | URL | Request) => Response.json({
    name: "main",
    protected: true,
    commit: { sha: "c".repeat(40) },
  }));
  await verifyReleaseGovernance({
    GITHUB_REPOSITORY: "nori72ny/myAIspecials",
    GITHUB_TOKEN: "synthetic-token-used-only-as-header",
  }, fetchMock as typeof fetch);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toBe("https://api.github.com/repos/nori72ny/myAIspecials/branches/main");
  expect(String(url)).not.toContain("synthetic-token");
  expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer synthetic-token-used-only-as-header" });
});
