import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const PUBLICATION_ID = /^site-[A-Za-z0-9_-]{22}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function productionBaseUrl(value) {
  const url = new URL(value ?? "https://origin-personal.vercel.app");
  assert.equal(url.protocol, "https:", "Publication smoke tests require HTTPS.");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function request(url, secret, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      accept: "application/json, text/html;q=0.9, text/css;q=0.8, text/javascript;q=0.8",
      "cache-control": "no-cache",
      "user-agent": "origin-publication-smoke/1.3.1",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(25_000),
  });
}

export async function verifyProductionPublication(env = process.env) {
  const baseUrl = productionBaseUrl(env.ORIGIN_PRODUCTION_URL);
  const secret = env.ORIGIN_AGENT_APPROVAL_SECRET;
  assert.ok(typeof secret === "string" && secret.length >= 32, "ORIGIN_AGENT_APPROVAL_SECRET must be supplied securely.");

  const marker = `ORIGIN publication smoke ${randomUUID()}`;
  const project = {
    kind: "landing",
    name: "ORIGIN Publication Smoke",
    description: "Temporary harmless production verification site.",
    locale: "en",
    pages: [
      {
        title: "Home",
        headline: marker,
        sections: [{ title: "Verification", body: "This temporary site is deleted immediately after verification." }],
      },
      { slug: "details", title: "Details", headline: "Publication route verified" },
    ],
  };

  let publicationId;
  let publicPath;
  let primaryError;
  try {
    const publish = await request(`${baseUrl}/api/builder/v1.3.1/publish`, secret, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ project, expiresInDays: 1, confirmPublic: true }),
    });
    assert.equal(publish.status, 201, `Publish must return HTTP 201; received ${publish.status}; response body withheld.`);
    const result = await publish.json();
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(result.freeOnly, true);
    assert.equal(result.costUsd, 0);
    assert.equal(result.paidFallbackUsed, false);
    assert.match(result.publicationId ?? "", PUBLICATION_ID);
    assert.match(result.projectSha256 ?? "", SHA256);
    assert.equal(result.publicPath, `/sites/${result.publicationId}/`);
    publicationId = result.publicationId;
    publicPath = result.publicPath;

    const home = await request(`${baseUrl}${publicPath}`, undefined);
    assert.equal(home.status, 200, "Published home page must return HTTP 200.");
    assert.match(home.headers.get("content-type") ?? "", /text\/html/i);
    assert.match(home.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(home.headers.get("x-origin-project-sha256"), result.projectSha256);
    assert.match(await home.text(), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const details = await request(`${baseUrl}${publicPath}details/`, undefined);
    assert.equal(details.status, 200, "Published nested page must return HTTP 200.");
    assert.match(await details.text(), /Publication route verified/);

    const css = await request(`${baseUrl}${publicPath}assets/styles.css`, undefined);
    assert.equal(css.status, 200, "Published CSS must return HTTP 200.");
    assert.match(css.headers.get("content-type") ?? "", /text\/css/i);

    const js = await request(`${baseUrl}${publicPath}assets/app.js`, undefined);
    assert.equal(js.status, 200, "Published JavaScript must return HTTP 200.");
    assert.match(js.headers.get("content-type") ?? "", /text\/javascript/i);
    assert.doesNotMatch(await js.text(), /\bfetch\s*\(/);

    const privateFile = await request(`${baseUrl}${publicPath}origin-manifest.json`, undefined);
    assert.equal(privateFile.status, 404, "Non-runtime project files must not be public.");
  } catch (error) {
    primaryError = error;
  } finally {
    if (publicationId) {
      try {
        const removed = await request(`${baseUrl}/api/builder/v1.3.1/publications/${publicationId}`, secret, { method: "DELETE" });
        assert.equal(removed.status, 200, `Delete must return HTTP 200; received ${removed.status}; response body withheld.`);
        const deleted = await removed.json();
        assert.deepEqual({ ok: deleted.ok, removed: deleted.removed, publicationId: deleted.publicationId }, { ok: true, removed: true, publicationId });
        assert.equal((await request(`${baseUrl}${publicPath}`, undefined)).status, 404, "Deleted publication must return HTTP 404.");
      } catch (cleanupError) {
        if (!primaryError) primaryError = cleanupError;
        else primaryError = new AggregateError([primaryError, cleanupError], "Publication verification and cleanup both failed.");
      }
    }
  }
  if (primaryError) throw primaryError;
  return { status: "passed", baseUrl, publicationId, publicPath, deleted: true, freeOnly: true, costUsd: 0, paidFallbackUsed: false };
}

if (process.argv[1]?.endsWith("verify-production-publication.mjs")) {
  try {
    console.log(JSON.stringify(await verifyProductionPublication()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
