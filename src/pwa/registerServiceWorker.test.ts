import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';
import { describe, it } from 'vitest';

type Listener = () => void;
function eventTarget() {
  const listeners = new Map<string, Array<{ callback: Listener; once: boolean }>>();
  return {
    addEventListener(type: string, callback: Listener, options?: { once?: boolean }) {
      const list = listeners.get(type) ?? [];
      list.push({ callback, once: options?.once === true });
      listeners.set(type, list);
    },
    emit(type: string) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((entry) => !entry.once));
      for (const { callback } of list) callback();
    },
  };
}

async function launch(controlled = false, waiting = false, claimBeforeResolve = false) {
  let reloads = 0;
  let activations = 0;
  const draft = { value: '' };
  const files = { files: [] as unknown[] };
  const busy = { value: false };
  const timers: Listener[] = [];
  const intervals: Listener[] = [];
  const storage = new Map<string, string>();
  const registration = {
    ...eventTarget(),
    waiting: waiting ? { postMessage: () => { activations += 1; } } : null,
    update: async () => undefined,
  };
  const serviceWorker = {
    ...eventTarget(),
    controller: controlled ? {} : null as object | null,
    register: async () => {
      if (claimBeforeResolve) {
        serviceWorker.controller = {};
        serviceWorker.emit('controllerchange');
      }
      return registration;
    },
  };
  const document = {
    ...eventTarget(),
    visibilityState: 'visible',
    documentElement: { dataset: { originStorageState: 'ready' } },
    querySelectorAll: (selector: string) => selector.includes('file') ? [files] : [draft],
    querySelector: () => busy.value ? {} : null,
  };
  const window = {
    ...eventTarget(),
    isSecureContext: true,
    self: {},
    top: {},
    location: { reload: () => { reloads += 1; } },
    dispatchEvent: () => true,
    setTimeout: (callback: Listener) => timers.push(callback),
    setInterval: (callback: Listener) => intervals.push(callback),
  };
  window.top = window.self;
  const source = readFileSync('src/pwa/registerServiceWorker.ts', 'utf8');
  const javascript = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exported: { registerOriginServiceWorker?: () => void } = {};
  runInNewContext(javascript, {
    exports: exported, window, document, navigator: { serviceWorker },
    CustomEvent: class {},
    sessionStorage: {
      removeItem: (key: string) => storage.delete(key),
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  exported.registerOriginServiceWorker!();
  window.emit('load');
  await Promise.resolve();
  await Promise.resolve();
  return {
    draft, files, busy, document, window, registration,
    reloads: () => reloads,
    activations: () => activations,
    changeController: () => { serviceWorker.controller = {}; serviceWorker.emit('controllerchange'); },
    flushTimers: () => { for (const callback of timers.splice(0)) callback(); },
    retry: () => { for (const callback of intervals) callback(); },
  };
}

describe('PWA controller changes preserve user work', () => {
  it('never reloads the first claim while Japanese input is being composed', async () => {
    const app = await launch();
    app.draft.value = '日本語を変換中です';
    app.changeController();
    assert.equal(app.reloads(), 0);
    assert.equal(app.draft.value, '日本語を変換中です');
    app.draft.value = '';
    app.retry();
    assert.equal(app.reloads(), 0);
  });

  it('does not mistake a claim before register resolves for an update', async () => {
    const app = await launch(false, false, true);
    assert.equal(app.reloads(), 0);
    app.changeController();
    assert.equal(app.reloads(), 1);
  });

  it('reloads a real update once when idle', async () => {
    const app = await launch(true);
    app.changeController();
    app.changeController();
    app.retry();
    assert.equal(app.reloads(), 1);
  });

  it('defers a cross-tab update until the draft is cleared and generation ends', async () => {
    const app = await launch(true);
    app.draft.value = '下書き';
    app.changeController();
    assert.equal(app.reloads(), 0);
    app.draft.value = '';
    app.busy.value = true;
    app.retry();
    assert.equal(app.reloads(), 0);
    app.busy.value = false;
    app.window.emit('origin:pwa-safe-apply');
    assert.equal(app.reloads(), 1);
  });

  it('rechecks work created after requesting waiting-worker activation', async () => {
    const app = await launch(true, true);
    assert.equal(app.activations(), 1);
    app.draft.value = '入力開始';
    app.changeController();
    assert.equal(app.reloads(), 0);
    app.draft.value = '';
    app.retry();
    assert.equal(app.reloads(), 1);
  });

  it('keeps whitespace drafts, attachments, hidden tabs and hydration safe', async () => {
    const app = await launch(true);
    app.draft.value = '　 ';
    app.changeController();
    assert.equal(app.reloads(), 0);
    app.draft.value = '';
    app.files.files = [{}];
    app.retry();
    assert.equal(app.reloads(), 0);
    app.files.files = [];
    app.document.visibilityState = 'hidden';
    app.retry();
    assert.equal(app.reloads(), 0);
    app.document.visibilityState = 'visible';
    app.document.documentElement.dataset.originStorageState = 'hydrating';
    app.retry();
    assert.equal(app.reloads(), 0);
    app.document.documentElement.dataset.originStorageState = 'ready';
    app.document.emit('visibilitychange');
    assert.equal(app.reloads(), 1);
  });

  it('activates a waiting update after unsaved work is cleared', async () => {
    const app = await launch(true);
    let activations = 0;
    app.registration.waiting = { postMessage: () => { activations += 1; } };
    app.draft.value = '編集中';
    app.retry();
    app.flushTimers();
    assert.equal(activations, 0);
    assert.equal(app.reloads(), 0);
    app.draft.value = '';
    app.retry();
    app.flushTimers();
    assert.equal(activations, 1);
    app.changeController();
    assert.equal(app.reloads(), 1);
  });
});
