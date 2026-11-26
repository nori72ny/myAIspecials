import assert from "node:assert/strict";
import { chromium } from "playwright";

const MODEL_BUSY_MESSAGE = "今、無料AIが混み合っています。入力した内容は残っています。少し待ってから、もう一度お試しください。";

function productionUrl(value) {
  const url = new URL(value ?? "https://origin-personal.vercel.app");
  const isLoopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  assert.ok(url.protocol === "https:" || isLoopback, "Production browser verification requires HTTPS except for an explicit loopback CI target.");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function evaluateAcrossOnePwaClaim(page, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!String(error).includes("Execution context was destroyed")) throw error;
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    await page.getByTestId("origin-orin-presence").waitFor({ state: "visible", timeout: 15_000 });
    return operation();
  }
}

async function verifyPwa(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Load anchor: the floating Orin presence is the app's only resident
    // character element (the home hero logo was removed in PR #1258).
    await page.getByTestId("origin-orin-presence").waitFor({ state: "visible", timeout: 15_000 });
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    assert.ok(manifestHref, "Production page must expose a web app manifest.");
    const manifestResponse = await context.request.get(new URL(manifestHref, baseUrl).toString(), { failOnStatusCode: true });
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, "standalone", "Production manifest must be installable in standalone mode.");
    assert.equal(manifest.start_url, "/", "Production manifest must start at the same-origin app root.");
    assert.equal(manifest.scope, "/", "Production manifest scope must remain same-origin root.");

    const worker = await evaluateAcrossOnePwaClaim(page, () => page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false, controlled: false, scope: "" };
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker ready timeout")), 10_000)),
      ]);
      return {
        supported: true,
        controlled: Boolean(navigator.serviceWorker.controller),
        scope: registration.scope,
      };
    }));
    assert.equal(worker.supported, true, "Production browser must support the registered service worker.");
    assert.ok(worker.scope.startsWith(new URL(baseUrl).origin), "Production service worker must remain same-origin.");
    return { manifest: true, serviceWorker: true, controlled: worker.controlled };
  } finally {
    await context.close();
  }
}

// Reads the stored history journal (localStorage "origin_personal_history")
// the way the E2E specs read stored records: when the value is an S3
// encrypted envelope ({ version, iv, ciphertext }), decrypt it in page with
// the device key (the 'aes-gcm-256' record in the app's IndexedDB) and
// return the parsed journal. A legacy plaintext value is returned as-is,
// mirroring the E2E readers; the release gate rejects that shape through
// the envelope-form assertion in verifyHistoryAndRecovery. Returns null
// when nothing readable is stored yet.
async function readStoredHistoryJournal(page) {
  return page.evaluate(async () => {
    const raw = localStorage.getItem("origin_personal_history");
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const isEnvelope = stored.version === 1
      && typeof stored.iv === "string"
      && typeof stored.ciphertext === "string"
      && !Array.isArray(stored.messages);
    if (!isEnvelope) return stored;
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("origin-personal-local", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexeddb-open-failed"));
    });
    try {
      const key = await new Promise((resolve, reject) => {
        const read = database.transaction("snapshots", "readonly").objectStore("snapshots").get("aes-gcm-256");
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error ?? new Error("indexeddb-read-failed"));
      });
      if (!key) return null;
      const decode = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(stored.iv) }, key, decode(stored.ciphertext));
      return JSON.parse(new TextDecoder().decode(plaintext));
    } finally {
      database.close();
    }
  });
}

async function restoreSavedSessionFromHistoryDrawer(page, expectedPrompt) {
  // UI audit #6 removed the history drawer's "その他の表示" expander and
  // the knowledge map: saved sessions are now restored directly from the
  // history session list, exactly as a user does. The session list count
  // is the exposure gate the knowledge-map node count used to provide.
  await page.getByTestId("history-drawer-toggle").click();
  const sessionItems = page.locator('[data-testid^="history-session-item-"]');
  await page.getByTestId("history-session-item-0").waitFor({ state: "visible", timeout: 10_000 });
  const sessionCount = await sessionItems.count();
  assert.ok(sessionCount >= 1, `Production history must expose at least one saved session; observed ${sessionCount}.`);
  const savedSession = sessionItems.filter({ hasText: expectedPrompt }).first();
  await savedSession.waitFor({ state: "visible", timeout: 10_000 });
  await savedSession.click();
}

async function startNewConversationFromSidebar(page) {
  // PR-D (IA cleanup) consolidated the new-conversation control into the
  // sidebar (testid "sidebar-new-conversation", label "新しい会話"); the
  // former header button "新しい会話を始める" no longer exists, and its
  // absence is pinned by App.test.tsx and the navigation E2E spec. Open
  // the drawer first when it is closed, mirroring the E2E specs.
  if ((await page.getByTestId("origin-sidebar").getAttribute("data-open")) !== "true") {
    await page.getByTestId("sidebar-toggle").click();
  }
  await page.getByTestId("sidebar-new-conversation").click();
}

async function verifyHistoryAndRecovery(browser, baseUrl) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  let requestCount = 0;
  const verifiedStream = (text) => [
    `data: ${JSON.stringify({ type: "delta", text })}`,
    `data: ${JSON.stringify({ type: "complete", modelId: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", costEvidenceStatus: "NOT_MEASURED", fallbackUsed: false })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");

  await page.route("**/api/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        headers: { "x-origin-stream-source": "upstream", "x-origin-stream-protocol": "origin-verified-sse-v1", "x-origin-cost-evidence": "NOT_MEASURED", "x-origin-model-id": "google/gemma-4-31b-it:free" },
        body: verifiedStream("セッションを整理しました。"),
      });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ code: "PROVIDER_UNAVAILABLE", message: "safe failure", retryable: true, requestId: "browser-production-test", retryAttempted: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      headers: { "x-origin-stream-source": "upstream", "x-origin-stream-protocol": "origin-verified-sse-v1", "x-origin-cost-evidence": "NOT_MEASURED", "x-origin-model-id": "google/gemma-4-31b-it:free" },
      body: verifiedStream("回復しました。"),
    });
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByTestId("origin-orin-presence").waitFor({ state: "visible", timeout: 15_000 });

    const firstPrompt = "本番履歴復元テスト-ORIGIN-20260908";
    await page.getByTestId("origin-home-request").fill(firstPrompt);
    await page.getByTestId("start-request-button").click();
    await page.getByText("セッションを整理しました。").waitFor({ state: "visible", timeout: 15_000 });

    // S3 (on-device history encryption): the journal in localStorage is an
    // encrypted envelope ({ version, iv, ciphertext }), so read it the way
    // the E2E specs do — decrypt it in page with the device key (the
    // 'aes-gcm-256' record in the same IndexedDB) and only then inspect
    // messages. The content match and the 10-second budget are unchanged
    // from the plaintext era. The poll runs from Node because this
    // Playwright version does not await async waitForFunction predicates
    // (a returned promise reads as truthy), which would let an in-page
    // async predicate pass instantly without checking anything.
    let journalContainsPrompt = false;
    const journalDeadline = Date.now() + 10_000;
    while (!journalContainsPrompt && Date.now() < journalDeadline) {
      const journal = await readStoredHistoryJournal(page).catch(() => null);
      journalContainsPrompt = journal?.messages?.some((message) => message.content === firstPrompt) ?? false;
      if (!journalContainsPrompt) await page.waitForTimeout(200);
    }
    assert.equal(journalContainsPrompt, true, "Production history journal must record the first exchange (decrypted) within 10 seconds.");

    // S3 gate assertion: after the exchange the stored journal must still
    // be the encrypted envelope form, so a regression to plaintext writes
    // fails the release gate by name instead of only by timeout.
    const journalForm = await page.evaluate(() => {
      const raw = localStorage.getItem("origin_personal_history");
      if (raw === null) return { stored: false, encryptedEnvelope: false };
      try {
        const parsed = JSON.parse(raw);
        const encryptedEnvelope = Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed)
          && parsed.version === 1
          && typeof parsed.iv === "string"
          && typeof parsed.ciphertext === "string"
          && !Array.isArray(parsed.messages);
        return { stored: true, encryptedEnvelope };
      } catch {
        return { stored: true, encryptedEnvelope: false };
      }
    });
    assert.equal(journalForm.stored, true, "Production history journal must be stored after the first exchange.");
    assert.equal(journalForm.encryptedEnvelope, true, "Production history journal must be stored as an encrypted envelope (S3), never plaintext.");

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    // Fresh loads always land on the top screen (owner instruction,
    // 2026-11-09): the in-progress conversation is archived into a history
    // session instead of being reopened, so restore it explicitly through
    // the history drawer, exactly as a user would.
    await page.getByTestId("origin-home-request").waitFor({ state: "visible", timeout: 15_000 });
    await restoreSavedSessionFromHistoryDrawer(page, firstPrompt);
    await page.locator("p").filter({ hasText: firstPrompt }).first().waitFor({ state: "visible", timeout: 15_000 });
    await page.getByText("セッションを整理しました。").waitFor({ state: "visible", timeout: 15_000 });

    await startNewConversationFromSidebar(page);
    await page.getByTestId("origin-home-request").waitFor({ state: "visible", timeout: 10_000 });
    await restoreSavedSessionFromHistoryDrawer(page, firstPrompt);
    await page.locator("p").filter({ hasText: firstPrompt }).first().waitFor({ state: "visible", timeout: 10_000 });

    await startNewConversationFromSidebar(page);
    await page.getByTestId("origin-home-request").fill("失敗回復を確認してください");
    await page.getByTestId("start-request-button").click();
    await page.getByText(MODEL_BUSY_MESSAGE).waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await page.getByTestId("response-verification-details").count(), 0, "Failed responses must not receive a verification badge.");

    await page.getByTestId("origin-chat-request").fill("回復後の回答を返してください");
    await page.getByTestId("origin-chat-request").press("Control+Enter");
    await page.getByText("回復しました。").waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(requestCount, 3, "Production browser verification must not retry failed inference requests automatically.");
    assert.equal(pageErrors.length, 0, `Production browser emitted page errors: ${pageErrors.join(" | ")}`);

    return { historyReload: true, newChat: true, historyRestore: true, failureUx: true, recovery: true, mockedChatRequests: requestCount };
  } finally {
    await context.close();
  }
}

export async function verifyProductionBrowser(env = process.env) {
  const baseUrl = productionUrl(env.ORIGIN_PRODUCTION_URL);
  const browser = await chromium.launch({ headless: true });
  try {
    const pwa = await verifyPwa(browser, baseUrl);
    const ui = await verifyHistoryAndRecovery(browser, baseUrl);
    return { baseUrl, pwa, ui };
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith("verify-production-browser.mjs")) {
  try {
    const result = await verifyProductionBrowser();
    console.log(JSON.stringify({ status: "passed", check: "origin-production-browser-pwa-history-failure-recovery", ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
