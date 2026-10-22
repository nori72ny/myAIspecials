// @vitest-environment jsdom
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
  let announcements = 0;
  const draft = { value: '' };
  // Use the browser DOM selector engine, not a selector-insensitive mock.
  const editorDocument = globalThis.document.implementation.createHTMLDocument('PWA editor regression');
  editorDocument.body.innerHTML = '<div id="rich-editor" contenteditable></div><div id="plaintext-editor" contenteditable="plaintext-only"></div><div id="disabled-editor" contenteditable="false"></div>';
  const richEditor = editorDocument.getElementById('rich-editor')!;
  const plaintextEditor = editorDocument.getElementById('plaintext-editor')!;
  const disabledEditor = editorDocument.getElementById('disabled-editor')!;
  let directTouchMode = false;
  const files = { files: [] as unknown[] };
  const busy = { value: false };
  const timers: Listener[] = [];
  const intervals: Listener[] = [];
  const storage = new Map<string, string>();
  const registration = {
    ...eventTarget(),
    installing: null as null | (ReturnType<typeof eventTarget> & { state: string }),
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
    documentElement: { dataset: { originStorageState: 'ready', originDirectTouchPending: 'false' } },
    querySelectorAll: (selector: string) => selector.includes('file') ? [files] : selector.includes('contenteditable') ? Array.from(editorDocument.querySelectorAll(selector)) : [draft],
    querySelector: (selector: string) => selector === '[data-testid="artifact-direct-touch-status"]' ? (directTouchMode ? {} : null) : busy.value ? {} : null,
  };
  const window = {
    ...eventTarget(),
    isSecureContext: true,
    self: {},
    top: {},
    location: { reload: () => { reloads += 1; } },
    dispatchEvent: () => { announcements += 1; return true; },
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
    draft, richEditor, plaintextEditor, disabledEditor, files, busy, document, window, registration,
    setDirectTouchMode: (value: boolean) => { directTouchMode = value; },
    reloads: () => reloads,
    activations: () => activations,
    announcements: () => announcements,
    installWaiting: () => {
      const installing = { ...eventTarget(), state: 'installing' };
      registration.installing = installing;
      registration.emit('updatefound');
      registration.waiting = { postMessage: () => { activations += 1; } };
      installing.state = 'installed';
      installing.emit('statechange');
    },
    changeController: () => { serviceWorker.controller = {}; serviceWorker.emit('controllerchange'); },
    flushTimers: () => { for (const callback of timers.splice(0)) callback(); },
    retry: () => { for (const callback of intervals) callback(); },
  };
}

describe('PWA controller changes preserve user work', () => {
  it('does not show an update notice for the first installation', async () => {
    const app = await launch();
    app.installWaiting();
    assert.equal(app.announcements(), 0);
    app.changeController();
    assert.equal(app.announcements(), 0);
    assert.equal(app.reloads(), 0);
  });

  it('announces a real waiting update and waits for a safe activation', async () => {
    const app = await launch(true);
    app.draft.value = '編集中';
    app.installWaiting();
    assert.equal(app.announcements(), 1);
    app.flushTimers();
    assert.equal(app.activations(), 0);
    app.draft.value = '';
    app.retry();
    app.flushTimers();
    assert.equal(app.activations(), 1);
  });

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
    app.document.documentElement.dataset.originStorageState = 'degraded';
    app.document.emit('visibilitychange');
    assert.equal(app.reloads(), 0);
    // Chat send may clear the input while its state snapshot is still queued.
    app.document.documentElement.dataset.originStorageState = 'saving';
    app.retry();
    assert.equal(app.reloads(), 0);
    app.document.documentElement.dataset.originStorageState = 'ready';
    app.document.emit('visibilitychange');
    assert.equal(app.reloads(), 1);
  });

  it('never activates an update during Japanese IME conversion before value commits', async () => {
    const app = await launch(true);
    app.document.emit('compositionstart');
    app.installWaiting();
    app.flushTimers();
    assert.equal(app.activations(), 0);
    app.changeController();
    assert.equal(app.reloads(), 0);
    app.document.emit('compositionend');
    app.retry();
    app.flushTimers();
    assert.equal(app.activations(), 1);
    assert.equal(app.reloads(), 1);
  });

  it('preserves contenteditable drafts and automatically applies after clearing them', async () => {
    const app = await launch(true);
    app.richEditor.textContent = '　変換途中の入力';
    app.installWaiting();
    app.flushTimers();
    assert.equal(app.activations(), 0);
    app.richEditor.textContent = '';
    app.retry();
    app.flushTimers();
    assert.equal(app.activations(), 1);
    app.changeController();
    assert.equal(app.reloads(), 1);
  });

  it('checks the actual DOM semantics for bare and plaintext-only contenteditable drafts', async () => {
    const app = await launch(true);
    app.richEditor.textContent = '  ';
    app.installWaiting();
    app.flushTimers();
    assert.equal(app.activations(), 0);
    app.richEditor.textContent = '';
    app.plaintextEditor.textContent = '日本語変換';
    app.retry();
    app.flushTimers();
    assert.equal(app.activations(), 0);
    app.plaintextEditor.textContent = '';
    app.disabledEditor.textContent = 'Not editable';
    app.retry();
    app.flushTimers();
    assert.equal(app.activations(), 1);
  });

  it('defers updates throughout Direct Touch iframe editing and until parent acknowledgement', async () => {
    const app = await launch(true);
    app.setDirectTouchMode(true);
    app.installWaiting();
    app.flushTimers();
    assert.equal(app.activations(), 0);
    app.setDirectTouchMode(false);
    app.document.documentElement.dataset.originDirectTouchPending = 'true';
    app.retry();
    app.flushTimers();
    assert.equal(app.activations(), 0);
    // A queued commit remains unsaved until the matching IndexedDB snapshot
    // actually completes, even if direct editing mode has been closed.
    app.document.documentElement.dataset.originDirectTouchPending = 'commit:artifact-1:v2';
    app.retry();
    app.flushTimers();
    assert.equal(app.activations(), 0);
    app.changeController();
    assert.equal(app.reloads(), 0);
    app.document.documentElement.dataset.originDirectTouchPending = 'false';
    app.window.emit('origin:pwa-safe-apply');
    app.flushTimers();
    assert.equal(app.activations(), 1);
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
