import { useEffect, useRef, useState } from 'react';

type Session = { userCode: string; verificationUri: string; expiresAt: number; nextCheckAt: number };
export function ImageProviderConnect({ language, onConnected, onCancel }: {
  language: 'ja' | 'en'; onConnected: () => void; onCancel: () => void;
}) {
  const en = language === 'en';
  const [session, setSession] = useState<Session | null>(null);
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
  const run = async (complete: boolean) => {
    if (controller.current || (complete && (!session || Date.now() < session.nextCheckAt || Date.now() >= session.expiresAt))) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setNotice('');
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await fetch(`/api/creative/v1.5/raster/connect/${complete ? 'complete' : 'start'}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}', signal: abort.signal,
      });
      const data = await response.json();
      if (abort.signal.aborted) return;
      if (complete && response.status === 202 && data.pending === true
        && ['authorization_pending', 'slow_down'].includes(data.code)
        && Number.isSafeInteger(data.interval) && data.interval > 0) {
        setSession(current => current ? { ...current, nextCheckAt: Date.now() + data.interval * 1000 } : null);
        setNotice(en ? 'Approval is still pending. Wait, then check again.' : '承認はまだ確認できません。少し待ってから再確認してください。');
        return;
      }
      if (!response.ok || data.ok !== true) throw new Error('connect-failed');
      if (complete) {
        if (data.connected !== true) throw new Error('not-connected');
        const status = await fetch('/api/creative/v1.5/raster/status', { credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
        const ready = await status.json();
        if (!status.ok || ready.ready !== true || ready.zeroCostVerified !== true || ready.freeOnly !== true || ready.paidFallbackEnabled !== false) throw new Error('not-ready');
        if (!abort.signal.aborted) onConnected();
      } else {
        const uri = new URL(data.verificationUri);
        if (uri.origin !== 'https://enter.pollinations.ai' || uri.username || uri.password
          || typeof data.userCode !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(data.userCode)
          || !Number.isFinite(data.expiresIn) || data.expiresIn < 1 || data.expiresIn > 1800
          || !Number.isFinite(data.interval) || data.interval < 1 || data.interval > 60) throw new Error('invalid-session');
        setNow(Date.now());
        setSession({ userCode: data.userCode, verificationUri: uri.href, expiresAt: Date.now() + data.expiresIn * 1000, nextCheckAt: Date.now() + data.interval * 1000 });
      }
    } catch {
      if (controller.current !== abort) return;
      setSession(null);
      setNotice(en ? 'Connection could not be verified. No image was generated. You can start again.' : '接続を確認できませんでした。画像は生成していません。もう一度開始できます。');
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  };
  const cancel = () => { controller.current?.abort(); controller.current = null; onCancel(); };
  const button = 'origin-secondary-button min-h-11 rounded-xl px-3 py-2 text-sm disabled:opacity-50';
  return <section aria-label={en ? 'Enable image generation' : '画像生成を有効にする'} className="origin-surface mb-3 rounded-2xl border p-4">
    <h2 className="font-semibold">{en ? 'Enable image generation' : '画像生成を有効にする'}</h2>
    <p className="mt-2 text-sm">{en ? 'Approve the connection with Pollinations. ORIGIN will resume your request after verifying a free image model.' : 'Pollinationsとの接続を承認してください。無料の画像モデルを確認してから、元の依頼を再開します。'}</p>
    {session && !expired ? <>
      <p className="my-3 break-all font-mono text-lg" aria-label={en ? 'Approval code' : '承認コード'}>{session.userCode}</p>
      <div className="flex flex-wrap gap-2">
        <a className={button} href={session.verificationUri} target="_blank" rel="noopener noreferrer">{en ? 'Open approval page' : '承認画面を開く'}</a>
        <button className={button} disabled={busy || now < session.nextCheckAt} onClick={() => void run(true)}>{en ? 'Check approval and resume' : '承認を確認して再開'}</button>
      </div>
    </> : <button className={`${button} mt-3`} disabled={busy} onClick={() => void run(false)}>{en ? 'Start connection' : '接続を開始'}</button>}
    <p role="status" className="mt-2 text-sm">{busy ? (en ? 'Checking…' : '確認しています…') : expired ? (en ? 'The code expired. Start again.' : 'コードの有効期限が切れました。接続を再開してください。') : notice}</p>
    <button className={`${button} mt-2`} onClick={cancel}>{en ? 'Cancel' : 'キャンセル'}</button>
  </section>;
}
