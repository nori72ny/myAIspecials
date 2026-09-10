import { afterEach, expect, it, vi } from "vitest";
import { verifyProductionPublication } from "./verify-production-publication.mjs";

afterEach(() => vi.unstubAllGlobals());

it("publishes, serves only runtime files, deletes, and verifies removal", async () => {
  const publicationId = `site-${"a".repeat(22)}`;
  const projectSha256 = "b".repeat(64);
  let marker = "";
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/builder/v1.3.1/publish")) {
      expect(init?.headers).toMatchObject({ authorization: "Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
      marker = JSON.parse(String(init?.body)).project.pages[0].headline;
      return Response.json({ ok: true, verified: true, freeOnly: true, costUsd: 0, paidFallbackUsed: false, publicationId, projectSha256, publicPath: `/sites/${publicationId}/` }, { status: 201 });
    }
    if (url.endsWith(`/api/builder/v1.3.1/publications/${publicationId}`)) return Response.json({ ok: true, removed: true, publicationId });
    if (url.endsWith(`/sites/${publicationId}/origin-manifest.json`)) return new Response("Not found", { status: 404 });
    if (url.endsWith(`/sites/${publicationId}/assets/styles.css`)) return new Response("body{}", { headers: { "content-type": "text/css" } });
    if (url.endsWith(`/sites/${publicationId}/assets/app.js`)) return new Response("console.log('ok')", { headers: { "content-type": "text/javascript" } });
    if (url.endsWith(`/sites/${publicationId}/details/`)) return new Response("Publication route verified");
    if (url.endsWith(`/sites/${publicationId}/`) && init?.method !== "DELETE") {
      const priorDelete = fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE");
      if (priorDelete) return new Response("Not found", { status: 404 });
      return new Response(marker, { headers: { "content-type": "text/html", "content-security-policy": "connect-src 'none'", "x-frame-options": "DENY", "x-robots-tag": "noindex, nofollow", "x-origin-project-sha256": projectSha256 } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  await expect(verifyProductionPublication({ ORIGIN_PRODUCTION_URL: "https://example.com", ORIGIN_AGENT_APPROVAL_SECRET: "x".repeat(32) })).resolves.toMatchObject({ status: "passed", publicationId, deleted: true, costUsd: 0 });
});

it("deletes a publication when a serving assertion fails and withholds response bodies", async () => {
  const publicationId = `site-${"a".repeat(22)}`;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ ok: true, verified: true, freeOnly: true, costUsd: 0, paidFallbackUsed: false, publicationId, projectSha256: "b".repeat(64), publicPath: `/sites/${publicationId}/` }, { status: 201 }))
    .mockResolvedValueOnce(new Response("private response body", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true, removed: true, publicationId }))
    .mockResolvedValueOnce(new Response("Not found", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);

  let observedError;
  try {
    await verifyProductionPublication({ ORIGIN_PRODUCTION_URL: "https://example.com", ORIGIN_AGENT_APPROVAL_SECRET: "x".repeat(32) });
  } catch (error) {
    observedError = error;
  }
  expect(String(observedError)).toContain("Published home page must return HTTP 200");
  expect(String(observedError)).not.toContain("private response body");
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(true);
});

it("fails before making a request when the server-only credential is unavailable", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(verifyProductionPublication({ ORIGIN_PRODUCTION_URL: "https://example.com" })).rejects.toThrow("must be supplied securely");
  expect(fetchMock).not.toHaveBeenCalled();
});
