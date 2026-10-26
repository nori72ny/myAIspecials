import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type WikiItem = { title: string; snippet: string; pageid: number };
type Task = { id: string; query: string; status: 'pending' | 'running' | 'done' | 'failed'; items: WikiItem[]; error?: string; updatedAt: number };
type WakeLockSentinelLike = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };

const DB_NAME = 'OriginUltraV16';
const STORE = 'tasks';
const LOCK_NAME = 'origin-ultra-runner';

class Vault {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.dbPromise = null; reject(request.error ?? new Error('IndexedDB open failed')); };
      request.onblocked = () => { this.dbPromise = null; reject(new Error('IndexedDB upgrade blocked')); };
    });
    return this.dbPromise;
  }
  async all(): Promise<Task[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Task[]).sort((a, b) => a.updatedAt - b.updatedAt));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  }
  async put(task: Task): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(task);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  }
  async clear(): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
    });
  }
}

const vault = new Vault();
const id = () => globalThis.crypto?.randomUUID?.() ?? `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function createWikiWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    // Load a same-origin static worker. This preserves worker isolation without requiring blob: in worker-src.
    return new Worker('/origin-ultra-wiki-worker.js', { name: 'origin-ultra-wiki-search' });
  } catch {
    return null;
  }
}
export default function OriginUltraV16() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [queryText, setQueryText] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<{ name: string; pass: boolean; detail: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [wakeHeld, setWakeHeld] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const wakeRef = useRef<WakeLockSentinelLike | null>(null);
  const stopRef = useRef(false);
  const heartbeatRef = useRef(Date.now());

  const log = useCallback((message: string) => setLogs(previous => [`[${new Date().toLocaleTimeString()}] ${message}`, ...previous].slice(0, 100)), []);
  const refresh = useCallback(async () => { try { setTasks(await vault.all()); } catch (error) { log(`保存データ読み込み失敗: ${String(error)}`); } }, [log]);

  useEffect(() => {
    void refresh();
    if (typeof window === 'undefined') {
      setDiagnostics([{ name: 'ブラウザ環境', pass: false, detail: 'テスト環境 / window API非対応のため待機中' }]);
      return;
    }
    const worker = createWikiWorker();
    workerRef.current = worker;
    if (!worker) {
      log('テスト環境 / Worker または Blob URL API 非対応のため待機中です。');
      setDiagnostics([{ name: 'Web Worker API', pass: false, detail: 'テスト環境 / API非対応。検索キューは待機状態です。' }]);
      return () => { workerRef.current = null; };
    }
    worker.onmessage = event => { if (event.data?.type === 'heartbeat') heartbeatRef.current = Date.now(); };
    const heartbeat = window.setInterval(() => {
      if (Date.now() - heartbeatRef.current > 15000) log('Worker heartbeat が15秒以上ありません。実行を安全停止してください。');
    }, 5000);
    return () => { window.clearInterval(heartbeat); worker.terminate(); workerRef.current = null; if (wakeRef.current) void wakeRef.current.release().catch(() => undefined); };
  }, [refresh, log]);

  const addTasks = async () => {
    const queries = [...new Set(queryText.split('\n').map(value => value.trim()).filter(Boolean))].slice(0, 10);
    if (!queries.length) return;
    try {
      for (const query of queries) await vault.put({ id: id(), query, status: 'pending', items: [], updatedAt: Date.now() });
      setQueryText('');
      await refresh();
      log(`${queries.length}件をキューに追加しました`);
    } catch (error) { log(`キュー追加失敗: ${String(error)}`); }
  };

  const search = (task: Task): Promise<WikiItem[]> => new Promise((resolve, reject) => {
    const worker = workerRef.current;
    if (!worker) { reject(new Error('Worker unavailable')); return; }
    const requestId = id();
    const timeout = window.setTimeout(() => { worker.removeEventListener('message', handler); reject(new Error('Wikipedia worker timeout')); }, 20000);
    const handler = (event: MessageEvent) => {
      if (event.data?.id !== requestId) return;
      window.clearTimeout(timeout); worker.removeEventListener('message', handler);
      if (event.data.ok) resolve(event.data.items as WikiItem[]); else reject(new Error(event.data.error || 'Wikipedia search failed'));
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ id: requestId, query: task.query });
  });

  const runQueue = async () => {
    if (running) return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.request !== 'function') { log('テスト環境 / Web Locks API 非対応のため、安全側に待機します。'); return; }
    if (!workerRef.current) { log('テスト環境 / Worker API 非対応のため、検索キューは待機中です。'); return; }
    setRunning(true); stopRef.current = false;
    try {
      await navigator.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { log('別タブが実行中のため開始しません。'); return; }
        const wake = await (navigator as NavigatorWithWakeLock).wakeLock?.request('screen').catch(() => null);
        wakeRef.current = wake ?? null; setWakeHeld(Boolean(wake));
        try {
          for (const task of await vault.all()) {
            if (stopRef.current) break;
            if (task.status !== 'pending') continue;
            const runningTask = { ...task, status: 'running' as const, updatedAt: Date.now() };
            await vault.put(runningTask); await refresh(); log(`検索開始: ${task.query}`);
            try {
              const items = await search(task);
              await vault.put({ ...runningTask, status: 'done', items, updatedAt: Date.now() });
              log(`検索完了: ${task.query} (${items.length}件)`);
            } catch (error) {
              await vault.put({ ...runningTask, status: 'failed', error: String(error), updatedAt: Date.now() });
              log(`検索失敗: ${task.query} — ${String(error)}`);
            }
            await refresh();
          }
        } finally {
          if (wakeRef.current) { await wakeRef.current.release().catch(() => undefined); wakeRef.current = null; }
          setWakeHeld(false);
        }
      });
    } catch (error) { log(`排他制御またはキュー実行エラー: ${String(error)}`); }
    finally { setRunning(false); await refresh(); }
  };

  const stop = () => { stopRef.current = true; log('停止要求を受け付けました。実行中の検索の完了後に停止します。'); };
  const clearAll = async () => {
    if (!window.confirm('全タスクと保存結果を削除しますか？')) return;
    await vault.clear(); await refresh(); log('タスクと保存結果を削除しました。');
  };
  const downloadReport = () => {
    const lines = ['# ORIGIN — 一括リサーチレポート', '', `生成日時: ${new Date().toLocaleString()}`, '出典: Wikipedia 日本語版 API', 'ライセンス: CC BY-SA 4.0 (各記事の帰属情報を参照)', ''];
    for (const task of tasks.filter(item => item.status === 'done')) {
      lines.push(`## ${task.query}`, '');
      for (const item of task.items) lines.push(`- [${item.title}](https://ja.wikipedia.org/?curid=${item.pageid}) — ${item.snippet}`);
      lines.push('');
    }
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') { log('この環境ではファイル保存 API が利用できません。'); return; }
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'origin-ultra-report.md'; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { log(`Markdown保存に失敗しました: ${String(error)}`); }
  };

  const runDiagnostics = async () => {
    const results: { name: string; pass: boolean; detail: string }[] = [];
    const hasWindow = typeof window !== 'undefined';
    const hasNavigator = typeof navigator !== 'undefined';
    const hasIndexedDB = hasWindow && typeof window.indexedDB !== 'undefined';
    const hasWorker = hasWindow && typeof window.Worker !== 'undefined';
    results.push({ name: 'IndexedDB 永続化', pass: hasIndexedDB, detail: hasIndexedDB ? 'API利用可能' : 'テスト環境 / IndexedDB非対応' });
    results.push({ name: 'Web Worker API', pass: hasWorker, detail: hasWorker ? 'API利用可能' : 'テスト環境 / Worker非対応' });
    results.push({ name: 'Web Locks 排他制御', pass: Boolean(hasNavigator && navigator.locks?.request), detail: hasNavigator && navigator.locks?.request ? 'API利用可能' : 'テスト環境 / 非対応。キューは安全待機' });
    const hasWakeLock = Boolean(hasNavigator && (navigator as NavigatorWithWakeLock).wakeLock?.request);
    results.push({ name: 'Screen Wake Lock', pass: hasWakeLock, detail: hasWakeLock ? 'API利用可能' : 'テスト環境 / 非対応（任意機能）' });
    try {
      if (typeof window === 'undefined' || typeof fetch !== 'function') throw new Error('テスト環境 / fetch API非対応');
      const response = await fetch('https://ja.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json&origin=*', { signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined });
      results.push({ name: 'Wikipedia API / CSP connect-src', pass: response.ok, detail: `HTTP ${response.status}` });
    } catch (error) { results.push({ name: 'Wikipedia API / CSP connect-src', pass: false, detail: String(error) }); }
    setDiagnostics(results); log(`自己診断: ${results.filter(result => result.pass).length}/${results.length} PASS`);
  };

  const toggle = (
    <div className="relative z-0 ml-auto flex w-fit justify-end pb-2">
      <button
        type="button"
        className="group inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-full border border-zinc-200/80 bg-white/80 px-3 py-1.5 text-zinc-600 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-zinc-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:border-zinc-700"
        aria-label="一括リサーチを開く"
        aria-expanded={isPanelOpen}
        aria-haspopup="dialog"
        data-testid="origin-ultra-v16-toggle"
        onClick={() => setIsPanelOpen(true)}
      >
        <span aria-hidden="true" className="text-sm text-emerald-500">✦</span>
        <span className="text-[11px] font-medium tracking-wider text-zinc-600 dark:text-zinc-300">一括リサーチ</span>
      </button>
    </div>
  );

  const modal = isPanelOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-6"
      data-testid="origin-ultra-v16-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setIsPanelOpen(false); }}
      onTouchStart={(event) => { if (event.target === event.currentTarget) setIsPanelOpen(false); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="一括リサーチ"
        className="origin-surface relative max-h-[min(85dvh,48rem)] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/30 bg-white/95 p-4 text-zinc-900 shadow-2xl backdrop-blur-2xl dark:border-zinc-700/70 dark:bg-zinc-950/95 dark:text-zinc-100 sm:p-6"
        data-testid="origin-ultra-v16"
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200/70 pb-3 dark:border-zinc-800">
          <div>
            <strong className="text-base">一括リサーチ — 調査タスク</strong>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">ローカル保存・キュー実行・自己診断</p>
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-xl text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-label="閉じる"
            title="閉じる"
            data-testid="origin-ultra-v16-close"
            onClick={() => setIsPanelOpen(false)}
          >✕</button>
        </div>
        <div className="grid gap-4 py-4">
          <label className="grid gap-2 text-sm font-semibold">Wikipedia 検索タスク（1行1件、最大10件）
            <textarea value={queryText} onChange={event => setQueryText(event.target.value)} rows={3} className="w-full rounded-xl border border-origin-border bg-white p-3 font-normal dark:bg-zinc-900" placeholder={'量子コンピュータ\n再生可能エネルギー'} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="origin-secondary-button min-h-10 rounded-lg px-3" onClick={() => void addTasks()}>キューに追加</button>
            <button type="button" className="origin-primary-button min-h-10 rounded-lg px-3" onClick={() => void runQueue()} disabled={running}>実行</button>
            <button type="button" className="origin-secondary-button min-h-10 rounded-lg px-3" onClick={stop} disabled={!running}>停止</button>
            <button type="button" className="origin-secondary-button min-h-10 rounded-lg px-3" onClick={() => void runDiagnostics()}>🧪 自己診断（5項目）</button>
            <button type="button" className="origin-secondary-button min-h-10 rounded-lg px-3" onClick={downloadReport}>Markdownレポート保存</button>
            <button type="button" className="origin-secondary-button min-h-10 rounded-lg px-3" onClick={() => void clearAll()}>全消去</button>
          </div>
          <p role="status" className="text-sm">状態: {running ? '実行中' : '待機中'} · Wake Lock: {wakeHeld ? '有効' : '未取得'} · DB: {DB_NAME}</p>
          <div className="grid gap-2">{tasks.map(task => <article key={task.id} className="rounded-xl border border-origin-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{task.query}</strong><span className="text-sm">{task.status}</span></div>
            {task.error && <p className="text-sm text-red-700">{task.error}</p>}
            {task.items.map(item => <div key={item.pageid} className="mt-2 text-sm"><a className="underline" href={`https://ja.wikipedia.org/?curid=${item.pageid}`} target="_blank" rel="noreferrer">{item.title}</a><p>{item.snippet}</p></div>)}
          </article>)}</div>
          {diagnostics.length > 0 && <div aria-label="自己診断結果" className="grid gap-2">{diagnostics.map(item => <p key={item.name} className="text-sm">{item.pass ? 'PASS' : 'CHECK'} · {item.name}: {item.detail}</p>)}</div>}
          {logs.length > 0 && <div aria-label="実行ログ" className="max-h-40 overflow-y-auto rounded-xl bg-black/5 p-3 font-mono text-xs dark:bg-white/5">{logs.map((line, index) => <p key={index}>{line}</p>)}</div>}
        </div>
      </section>
    </div>,
    document.body
  ) : null;

  useEffect(() => {
    if (!isPanelOpen) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPanelOpen(false);
    };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [isPanelOpen]);

  return <>{toggle}{modal}</>;
}
