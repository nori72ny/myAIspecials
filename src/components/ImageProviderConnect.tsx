import { useEffect, useRef, useState } from 'react';

type Session = { authorizationUri: string; expiresAt: number };

export function ImageProviderConnect({ language, onConnected, onCancel }: {
  language: 'ja' | 'en'; onConnected: () => void; onCancel: () => void;
}) {
  const en = language === 'en';
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);

  const expired = Boolean(session && now >= session.expiresAt);

  const verifyReadiness = async (signal: AbortSignal) => {
    const status = await fetch('/api/creative/v1.5/raster/status', {
      credentials: 'same-origin', cache: 'no-store', signal,
    });
    const ready = await status.json();
    if (!status.ok || ready.ready !== true || ready.zeroCostVerified !== true
      || ready.freeOnly !== true || ready.paidFallbackEnabled !== false) {
      throw new Error('not-ready');
    }
    onConnected();
  };

  const run = async (operation: 'start' | 'ready' | 'disconnect') => {
    if ((operation === 'ready' || operation === 'disconnect') && !connected && operation === 'disconnect') return;
    if (operation === 'start' && connected) return;
    if (controller.current || (operation === 'ready' && session && Date.now() >= session.expiresAt)) return;

    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setNotice('');
    const timer = setTimeout(() => abort.abort(), 15_000);

    try {
      if (operation === 'start') {
        const response = await fetch('/api/creative/v1.5/raster/connect/start', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: '{}', signal: abort.signal,
        });
        const data = await response.json();
        if (!response.ok || data.ok !== true) throw new Error('connect-start-failed');

        const uri = new URL(data.authorizationUri);
        if (uri.origin !== 'https://enter.pollinations.ai' || uri.pathname !== '/authorize'
          || uri.username || uri.password
          || uri.searchParams.get('budget') !== '0'
          || uri.searchParams.get('scope') !== 'usage'
          || uri.searchParams.get('models') !== 'tomdacatto/sana'
          || typeof data.expiresIn !== 'number' || data.expiresIn < 60 || data.expiresIn > 1800) {
          throw new Error('invalid-session');
        }

        setNow(Date.now());
        setSession({ authorizationUri: uri.href, expiresAt: Date.now() + data.expiresIn * 1000 });
        return;
      }

      if (operation === 'disconnect') {
        const response = await fetch('/api/creative/v1.5/raster/connect/disconnect', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: '{}', signal: abort.signal,
        });
        const data = await response.json();
        if (!response.ok || data.ok !== true || data.connected !== false) throw new Error('disconnect-failed');
        setConnected(false);
        setSession(null);
        setNotice(en ? 'Disconnected in this browser.' : 'このブラウザの接続を解除しました。');
        return;
      }

      const connection = await fetch('/api/creative/v1.5/raster/connect/status', {
        credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
      });
      const state = await connection.json();
      if (!connection.ok || state.connected !== true) {
        setNotice(en
          ? 'Approval is not confirmed yet. Complete the Pollinations approval, then check again.'
          : '承認をまだ確認できません。Pollinationsの承認を完了してから、もう一度確認してください。');
        return;
      }

      setConnected(true);
      setSession(null);
      await verifyReadiness(abort.signal);
    } catch {
      if (controller.current !== abort) return;
      if (operation === 'ready' && connected) {
        setNotice(en
          ? 'Connection is approved, but no verified zero-cost image model is ready. No image was generated.'
          : '接続は承認済みですが、費用0円を検証済みの画像モデルを確認できません。画像は生成していません。');
      } else if (operation === 'disconnect') {
        setNotice(en
          ? 'Disconnection could not be confirmed. You can try again.'
          : '接続解除を確認できませんでした。もう一度お試しください。');
      } else {
        setSession(null);
        setNotice(en
          ? 'Connection could not be prepared. No image was generated.'
          : '接続を準備できませんでした。画像は生成していません。');
      }
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    onCancel();
  };

  const button = 'origin-secondary-button min-h-11 rounded-xl px-3 py-2 text-sm disabled:opacity-50';

  return <section aria-label={en ? 'Enable image generation' : '画像生成を有効にする'} className="origin-surface mb-3 rounded-2xl border p-4">
    <h2 className="font-semibold">{en ? 'Enable image generation' : '画像生成を有効にする'}</h2>
    <p className="mt-2 text-sm">
      {connected
        ? (en
          ? 'Approval is complete. ORIGIN will only resume when the live model and request usage both prove exact $0.'
          : '承認は完了しています。ライブモデルと実リクエスト利用明細の両方で費用0円を証明できた場合だけ、元の依頼を再開します。')
        : (en
          ? 'Approve Pollinations with one audited model and a zero-Pollen spending cap. ORIGIN will not enable a paid path.'
          : 'Pollinationsで、監査済みモデル1つ・Pollen支出上限0の接続だけを承認します。有料経路は有効にしません。')}
    </p>

    {connected ? <div className="mt-3 flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => void run('ready')}>
        {en ? 'Check zero-cost model again' : '費用0円モデルを再確認'}
      </button>
      <button className={button} disabled={busy} onClick={() => void run('disconnect')}>
        {en ? 'Disconnect in this browser' : 'このブラウザの接続を解除'}
      </button>
    </div> : session && !expired ? <>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className={button} href={session.authorizationUri} target="_blank" rel="noopener noreferrer">
          {en ? 'Open approval page' : '承認画面を開く'}
        </a>
        <button className={button} disabled={busy} onClick={() => void run('ready')}>
          {en ? 'Check approval and resume' : '承認を確認して再開'}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {en
          ? 'The approval page opens separately. Return here after approving.'
          : '承認画面は別タブで開きます。承認後、この画面に戻って確認してください。'}
      </p>
    </> : <button className={`${button} mt-3`} disabled={busy} onClick={() => void run('start')}>
      {en ? 'Start secure connection' : '安全な接続を開始'}
    </button>}

    <p role="status" className="mt-2 text-sm">
      {busy
        ? (en ? 'Checking…' : '確認しています…')
        : expired
          ? (en ? 'The approval request expired. Start again.' : '承認リクエストの有効期限が切れました。接続を再開してください。')
          : notice}
    </p>
    <button className={`${button} mt-2`} onClick={cancel}>
      {connected ? (en ? 'Close' : '閉じる') : (en ? 'Cancel' : 'キャンセル')}
    </button>
  </section>;
}
