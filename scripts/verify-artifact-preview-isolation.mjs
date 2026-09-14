import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const baseUrl = String(process.env.ORIGIN_PRODUCTION_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const receiverOrigin = 'https://origin-egress.invalid';
const browserTypes = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
const requestedBrowsers = new Set(String(process.env.ORIGIN_ISOLATION_BROWSERS || 'chromium,firefox,webkit').split(',').map((name) => name.trim()).filter(Boolean));
const selectedBrowserTypes = browserTypes.filter(([name]) => requestedBrowsers.has(name));
assert.ok(selectedBrowserTypes.length > 0, 'No supported artifact-isolation browser was selected');

const artifactHtml = `
<style>body{font-family:system-ui}#safe-render{padding:12px}</style>
<main id="safe-render">Safe isolated preview</main>
<a id="external-link" href="${receiverOrigin}/link">external link</a>
<form id="external-form" action="${receiverOrigin}/form" method="post"><button id="form-submit" type="submit">submit</button></form>
<img id="external-image" alt="blocked external image" src="${receiverOrigin}/image.png">
<iframe id="nested-frame" src="${receiverOrigin}/nested"></iframe>
<meta http-equiv="refresh" content="0;url=${receiverOrigin}/refresh">
<button id="location-nav" onclick="location.href='${receiverOrigin}/location'">navigate</button>
<button id="document-write" onclick="document.open();document.write('<main id=\'rewritten\'>rewritten</main>');document.close()">rewrite</button>
<script>
window.__originArtifactAuthoredScriptRan = true;
fetch('${receiverOrigin}/fetch', { credentials: 'include' }).catch(function(){});
fetch('/api/health?origin-preview-auth-probe=1', { credentials: 'include' }).catch(function(){});
parent.postMessage({source:'ORIGIN_SANDBOX_BOUNDARY',type:'runtime-error',message:'artifact-forged-boundary'}, '*');
</script>`;

async function verifyBrowser(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const receiverRequests = [];
    const authProbeRequests = [];
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(String(error?.message || error)));
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith(receiverOrigin)) receiverRequests.push(url);
      if (url.includes('origin-preview-auth-probe=1')) authProbeRequests.push(url);
    });
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: `\`\`\`html:isolation-probe.html\n${artifactHtml}\n\`\`\``,
    }));

    let appReady = false;
    for (let attempt = 0; attempt < 3 && !appReady; attempt += 1) {
      const response = await page.goto(baseUrl, { waitUntil: 'load' });
      assert.equal(response?.status(), 200, `${name}: app shell unavailable`);
      appReady = await page.getByTestId('origin-home-request').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    }
    assert.ok(appReady, `${name}: app did not become ready: ${browserErrors.join(' | ') || (await page.locator('body').innerText()).slice(0, 500)}`);
    await page.evaluate(() => {
      localStorage.setItem('origin-preview-parent-canary', 'parent-only');
      document.cookie = 'origin_preview_canary=parent-only; path=/; SameSite=Lax';
    });
    const workspace = page.getByTestId('artifact-workspace');
    const requestInput = page.getByTestId('origin-home-request');
    const startButton = page.getByTestId('start-request-button');
    for (let attempt = 0; attempt < 5 && !(await workspace.isVisible().catch(() => false)); attempt += 1) {
      await requestInput.fill('artifact isolation probe');
      await page.waitForTimeout(150);
      await startButton.evaluate((button) => {
        if (!(button instanceof HTMLButtonElement) || button.disabled) throw new Error('request button is not ready');
        button.click();
      }).catch(() => undefined);
      await workspace.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
    }
    await workspace.waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByRole('button', { name: /プレビューを表示|Show preview/ }).click();
    const preview = workspace.getByTitle(/プレビュー|Preview/);
    await preview.waitFor({ state: 'visible' });
    assert.equal(await preview.getAttribute('sandbox'), 'allow-scripts', `${name}: iframe sandbox changed`);
    assert.equal(await preview.getAttribute('referrerpolicy'), 'no-referrer', `${name}: preview referrer policy changed`);
    const frame = preview.contentFrame();
    await frame.locator('#safe-render').waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await frame.locator('#safe-render').textContent(), 'Safe isolated preview', `${name}: safe content did not render`);

    const state = await frame.locator('body').evaluate(() => {
      const readCookie = () => { try { return document.cookie; } catch { return 'blocked'; } };
      const readStorage = () => { try { return localStorage.getItem('origin-preview-parent-canary'); } catch { return 'blocked'; } };
      return {
        authoredScriptRan: Boolean(window.__originArtifactAuthoredScriptRan),
        parentCanary: readStorage(),
        cookie: readCookie(),
        nestedFrames: document.querySelectorAll('iframe,frame,object,embed').length,
        externalImageSrc: document.querySelector('#external-image')?.getAttribute('src') ?? null,
        externalLinkHref: document.querySelector('#external-link')?.getAttribute('href') ?? null,
        externalFormAction: document.querySelector('#external-form')?.getAttribute('action') ?? null,
        locationHandler: document.querySelector('#location-nav')?.getAttribute('onclick') ?? null,
        writeHandler: document.querySelector('#document-write')?.getAttribute('onclick') ?? null,
        refreshCount: document.querySelectorAll('meta[http-equiv="refresh" i]').length,
      };
    });
    assert.equal(state.authoredScriptRan, false, `${name}: artifact-authored script executed`);
    assert.equal(state.parentCanary, null, `${name}: preview exposed parent localStorage`);
    assert.ok(state.cookie === '' || state.cookie === 'blocked', `${name}: preview exposed parent cookie`);
    assert.equal(state.nestedFrames, 0, `${name}: nested frame survived sanitization`);
    assert.equal(state.externalImageSrc, null, `${name}: external image source survived sanitization`);
    assert.equal(state.externalLinkHref, null, `${name}: external link survived sanitization`);
    assert.equal(state.externalFormAction, null, `${name}: external form action survived sanitization`);
    assert.equal(state.locationHandler, null, `${name}: location handler survived sanitization`);
    assert.equal(state.writeHandler, null, `${name}: document.write handler survived sanitization`);
    assert.equal(state.refreshCount, 0, `${name}: refresh redirect survived sanitization`);

    for (const selector of ['#external-link', '#form-submit', '#location-nav', '#document-write']) {
      const control = frame.locator(selector);
      if (await control.count()) await control.click().catch(() => undefined);
    }
    await page.waitForTimeout(300);
    assert.equal(page.url().replace(/\/$/, ''), baseUrl, `${name}: artifact changed top-level location`);
    assert.equal(receiverRequests.length, 0, `${name}: forbidden receiver was reached: ${receiverRequests.join(', ')}`);
    assert.equal(authProbeRequests.length, 0, `${name}: sandbox attempted credentialed same-origin fetch`);
    assert.equal(await page.evaluate(() => localStorage.getItem('origin-preview-parent-canary')), 'parent-only', `${name}: parent storage changed`);
    assert.ok(!(await workspace.textContent()).includes('artifact-forged-boundary'), `${name}: forged boundary message affected parent UI`);

    const direct = await context.newPage();
    const response = await direct.goto(`${baseUrl}/origin-artifact-sandbox.html?direct-open-proof=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200, `${name}: direct sandbox URL unavailable`);
    const csp = String((await response?.allHeaders())?.['content-security-policy'] || '');
    assert.match(csp, /connect-src 'none'/, `${name}: direct sandbox CSP must block connections`);
    assert.match(csp, /form-action 'none'/, `${name}: direct sandbox CSP must block forms`);
    assert.match(csp, /frame-src 'none'/, `${name}: direct sandbox CSP must block child frames`);
    await direct.evaluate(() => window.postMessage({ source: 'ORIGIN_SANDBOX_INIT', html: '<main id="direct-injected">bad</main><script>location.href="https://origin-egress.invalid/direct"<\/script>' }, '*'));
    await direct.waitForTimeout(200);
    assert.equal(await direct.locator('#direct-injected').count(), 0, `${name}: direct-open runtime accepted self-init`);
    assert.match(await direct.locator('body').innerText(), /プレビューを準備しています/, `${name}: direct-open runtime did not remain inert`);
    await direct.close();

    await context.close();
    console.log(JSON.stringify({ browser: name, receiverRequests: receiverRequests.length, authProbeRequests: authProbeRequests.length, directOpen: 'inert', rendering: 'ok' }));
  } finally {
    await browser.close();
  }
}

for (const [name, browserType] of selectedBrowserTypes) {
  await verifyBrowser(name, browserType);
}

console.log(JSON.stringify({ ok: true, boundary: 'artifact-preview-isolation', browsers: selectedBrowserTypes.map(([name]) => name), baseUrl }));
