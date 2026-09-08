import assert from "node:assert/strict";
import { chromium } from "playwright";

const MODEL_BUSY_MESSAGE = "現在、無料AIの利用が集中しています。費用0円ポリシーを維持するため自動再試行せず、今回は安全に回答を返せませんでした。少し時間をおいて、もう一度お試しください。";

function productionUrl(value) {
  const url = new URL(value ?? "https://origin-personal.vercel.app");
  assert.equal(url.protocol, "https:", "Production browser verification requires HTTPS.");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function verifyPwa(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByTestId("origin-core-logo").waitFor({ state: "visible", timeout: 15_000 });
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    assert.ok(manifestHref, "Production page must expose a web app manifest.");
    const manifest = await page.evaluate(async (href) => {
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      return response.json();
    }, manifestHref);
    assert.equal(manifest.display, "standalone", "Production manifest must be installable in standalone mode.");
    assert.equal(manifest.start_url, "/", "Production manifest must start at the same-origin app root.");
    assert.equal(manifest.scope, "/", "Production manifest scope must remain same-origin root.");

    const worker = await page.evaluate(async () => {
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
    });
    assert.equal(worker.supported, true, "Production browser must support the registered service worker.");
    assert.ok(worker.scope.startsWith(new URL(baseUrl).origin), "Production service worker must remain same-origin.");
    return { manifest: true, serviceWorker: true, controlled: worker.controlled };
  } finally {
    await context.close();
  }
}

async function verifyHistoryAndRecovery(browser, baseUrl) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  let requestCount = 0;

  await page.route("**/api/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "セッションを整理しました。" });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ code: "PROVIDER_UNAVAILABLE", message: "safe failure", retryable: true, requestId: "browser-production-test", retryAttempted: false }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "回復しました。" });
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByTestId("origin-core-logo").waitFor({ state: "visible", timeout: 15_000 });

    const firstPrompt = "本番履歴復元テスト-ORIGIN-20260908";
    await page.getByTestId("origin-home-request").fill(firstPrompt);
    await page.getByTestId("start-request-button").click();
    await page.getByText("セッションを整理しました。").waitFor({ state: "visible", timeout: 15_000 });

    await page.waitForFunction((expected) => {
      try {
        const journal = JSON.parse(localStorage.getItem("origin_personal_history") ?? "null");
        return journal?.messages?.some((message) => message.content === expected);
      } catch { return false; }
    }, firstPrompt, { timeout: 10_000 });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText(firstPrompt).waitFor({ state: "visible", timeout: 15_000 });
    await page.getByText("セッションを整理しました。").waitFor({ state: "visible", timeout: 15_000 });

    await page.getByRole("button", { name: "新規対話を開始" }).click();
    await page.getByTestId("origin-home-request").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("history-drawer-toggle").click();
    await page.getByTestId("knowledge-map-toggle").click();
    const nodeCount = Number(await page.getByTestId("knowledge-map-node-count").textContent());
    assert.ok(nodeCount >= 1, `Production history must expose at least one saved session; observed ${nodeCount}.`);
    await page.getByTestId("knowledge-map-session-0").click();
    await page.getByText(firstPrompt).waitFor({ state: "visible", timeout: 10_000 });

    await page.getByRole("button", { name: "新規対話を開始" }).click();
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
