import { useCallback, useEffect, useRef, useState } from 'react';
import McpGithubBootstrapSettings from './McpGithubBootstrapSettings';

type Connection = { id: string; serverId: string; version: number; status: 'registered' | 'verified' | 'failed'; checkedAt: string | null };
type ServerChoice = { id: string; label: string; authMode: 'oauth' | 'broker' };
type Overview = { configured: boolean; authenticated: boolean; servers?: ServerChoice[]; connections?: Connection[] };
type ToolSummary = { alias: string; name: string; fingerprint: string; description: string };
type ToolReview = { version: number; tools: ToolSummary[]; selected: string[] };
const copy = {
  ja: {
    title: '外部サービス接続', help: '許可されたサービスを登録し、接続を確認できます。', loading: '確認しています…',
    setup: '外部サービス接続は準備中です。認証と保存先の設定が完了すると利用できます。',
    login: '接続を管理するには、オーナー認証が必要です。', loginHelp: 'Supabaseのオーナーアカウントでログインします。パスワードは保存されません。',
    email: 'メールアドレス', password: 'パスワード', signIn: 'ログイン', restore: 'セッションを復元', logout: 'ログアウト',
    signedIn: 'ログインしました。', restored: 'セッションを復元しました。', signedOut: 'ログアウトしました。',
    loginFailed: 'ログインできませんでした。認証情報を確認してください。', sessionExpired: 'セッションを復元できませんでした。再度ログインしてください。',
    choose: '接続するサービス', select: 'サービスを選択', add: '登録', oauth: '認証を開始', oauthContinue: '公式の認証画面へ進む',
    oauthReady: '認証画面を開いて連携を完了してください。', check: '接続を確認', remove: '解除', refresh: '再読み込み',
    empty: '登録済みの接続はありません。', error: '操作を完了できませんでした。再読み込みしてお試しください。',
    credential: 'このサービスの認証連携がまだ完了していません。', changed: '接続情報が更新されています。再読み込みしてください。',
    saved: '接続を登録しました。', removed: '接続を解除しました。', verified: '接続を確認しました。',
    failed: '接続を確認できませんでした。認証連携やサービスの状態を確認してください。', registered: '未確認', checked: '接続確認済み',
    unavailable: '接続確認に失敗', notice: '接続確認ではサービス内のデータを変更しません。', unknown: 'サービス',
    reviewTools: 'ツール権限', toolsHelp: '実行を許可するツールだけ選択してください。ツール定義が変わると以前の許可は無効になります。',
    saveTools: '権限を保存', noTools: '利用可能なツールはありません。', grantsSaved: 'ツール権限を保存しました。',
    catalogChanged: 'ツール定義が更新されました。再読み込みして確認してください。',
  },
  en: {
    title: 'External services', help: 'Register an approved service and check its connection.', loading: 'Checking…',
    setup: 'External connections are being prepared. Authentication and storage must be configured first.',
    login: 'Owner authentication is required to manage connections.', loginHelp: 'Sign in with the approved Supabase owner account. Your password is never stored.',
    email: 'Email address', password: 'Password', signIn: 'Sign in', restore: 'Restore session', logout: 'Sign out',
    signedIn: 'Signed in.', restored: 'Session restored.', signedOut: 'Signed out.',
    loginFailed: 'Sign-in failed. Check your credentials.', sessionExpired: 'The session could not be restored. Sign in again.',
    choose: 'Service to connect', select: 'Select a service', add: 'Register', oauth: 'Start authorization', oauthContinue: 'Continue to the official authorization page',
    oauthReady: 'Open the authorization page to finish linking the service.', check: 'Check connection', remove: 'Disconnect', refresh: 'Refresh',
    empty: 'No connections registered.', error: 'The operation could not be completed. Refresh and try again.',
    credential: 'Authentication for this service has not been linked yet.', changed: 'The connection has changed. Refresh before trying again.',
    saved: 'Connection registered.', removed: 'Connection disconnected.', verified: 'Connection verified.',
    failed: 'Could not verify the connection. Check authentication and service availability.', registered: 'Not checked', checked: 'Connection verified',
    unavailable: 'Connection check failed', notice: 'Checking a connection does not modify service data.', unknown: 'Service',
    reviewTools: 'Tool access', toolsHelp: 'Select only the tools ORIGIN may execute. A changed tool definition invalidates the previous grant.',
    saveTools: 'Save access', noTools: 'No tools are available.', grantsSaved: 'Tool access saved.',
    catalogChanged: 'The tool catalog changed. Reload and review it again.',
  },
};
function parseOverview(value: unknown): Overview {
  const v = value as Overview;
  if (!v || typeof v.configured !== 'boolean' || typeof v.authenticated !== 'boolean') throw new Error();
  if (v.configured && v.authenticated && (!Array.isArray(v.servers) || !Array.isArray(v.connections) || v.servers.length > 20 || v.connections.length > 20 ||
    v.servers.some(s => !s || typeof s.id !== 'string' || typeof s.label !== 'string' || !['oauth', 'broker'].includes(s.authMode)) ||
    v.connections.some(c => !c || typeof c.id !== 'string' || typeof c.serverId !== 'string' || !Number.isSafeInteger(c.version) || !['registered', 'verified', 'failed'].includes(c.status)))) throw new Error();
  return v;
}
export default function McpConnectionsSettings({ language }: { language: 'ja' | 'en' }) {
  const t = copy[language];
  const [expanded, setExpanded] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [toolReviews, setToolReviews] = useState<Record<string, ToolReview>>({});
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const emailInput = useRef<HTMLInputElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);

  const run = useCallback(async (action?: { path: string; method: 'POST' | 'DELETE'; body: object; success: string; oauth?: boolean }) => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const sequence = ++generation.current; const timer = window.setTimeout(() => request.abort(), 25_000);
    setBusy(true); setMessage(''); if (action) setAuthorizationUrl('');
    try {
      let note = '';
      if (action) {
        const response = await fetch(action.path, {
          method: action.method,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Origin-MCP-Intent': 'manage' },
          body: JSON.stringify(action.body),
          signal: request.signal,
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) {
          const nextMessage = result.code === 'MCP_CREDENTIAL_NOT_LINKED' ? t.credential
            : result.code === 'MCP_CONNECTION_CHANGED' ? t.changed
              : result.code === 'MCP_LOGIN_FAILED' ? t.loginFailed
                : result.code === 'MCP_SESSION_EXPIRED' ? t.sessionExpired
                  : t.error;
          throw new Error(nextMessage);
        }
        if (action.oauth) {
          if (typeof result.authorizationUrl !== 'string' || result.authorizationUrl.length > 8192) throw new Error(t.error);
          const url = new URL(result.authorizationUrl);
          if (url.protocol !== 'https:') throw new Error(t.error);
          if (generation.current === sequence) { setAuthorizationUrl(url.href); setMessage(action.success); }
          return;
        }
        note = result.verified === false ? t.failed : action.success;
      }
      const response = await fetch('/api/mcp/status', { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error(t.error);
      const data = parseOverview(await response.json());
      if (generation.current === sequence) { setOverview(data); setMessage(note); }
    } catch (error) {
      if (generation.current === sequence) {
        if (!action) setOverview(null);
        setAuthorizationUrl('');
        const allowed = [t.error, t.credential, t.changed, t.loginFailed, t.sessionExpired];
        setMessage(error instanceof Error && allowed.includes(error.message) ? error.message : t.error);
      }
    } finally { window.clearTimeout(timer); if (generation.current === sequence) setBusy(false); }
  }, [t]);

  const reviewTools = useCallback(async (connection: Connection) => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const sequence = ++generation.current; const timer = window.setTimeout(() => request.abort(), 25_000);
    setBusy(true); setMessage('');
    try {
      const suffix = `?version=${encodeURIComponent(String(connection.version))}`;
      const [catalogResponse, grantsResponse] = await Promise.all([
        fetch(`/api/mcp/connections/${encodeURIComponent(connection.id)}/tools${suffix}`, { credentials: 'same-origin', cache: 'no-store', signal: request.signal }),
        fetch(`/api/mcp/connections/${encodeURIComponent(connection.id)}/grants${suffix}`, { credentials: 'same-origin', cache: 'no-store', signal: request.signal }),
      ]);
      const [catalogResult, grantsResult] = await Promise.all([catalogResponse.json(), grantsResponse.json()]);
      if (!catalogResponse.ok || catalogResult.ok !== true || !grantsResponse.ok || grantsResult.ok !== true
        || !Array.isArray(catalogResult.tools) || catalogResult.tools.length > 200 || !Array.isArray(grantsResult.grants) || grantsResult.grants.length > 200) throw new Error(t.error);
      const tools: ToolSummary[] = catalogResult.tools.map((tool: unknown) => {
        const value = tool as ToolSummary;
        if (!value || typeof value.alias !== 'string' || typeof value.name !== 'string' || typeof value.fingerprint !== 'string'
          || !/^[A-Za-z0-9_]{1,64}$/.test(value.alias) || !/^[a-f0-9]{64}$/.test(value.fingerprint)
          || typeof value.description !== 'string' || value.description.length > 1000) throw new Error(t.error);
        return { alias: value.alias, name: value.name, fingerprint: value.fingerprint, description: value.description };
      });
      const approved = new Set((grantsResult.grants as unknown[]).map(grant => {
        const value = grant as { name?: unknown; fingerprint?: unknown };
        if (typeof value?.name !== 'string' || typeof value?.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new Error(t.error);
        return `${value.name}\0${value.fingerprint}`;
      }));
      const selected = tools.filter(tool => approved.has(`${tool.name}\0${tool.fingerprint}`)).map(tool => tool.alias);
      if (generation.current === sequence) setToolReviews(current => ({ ...current, [connection.id]: { version: connection.version, tools, selected } }));
    } catch {
      if (generation.current === sequence) setMessage(t.error);
    } finally { window.clearTimeout(timer); if (generation.current === sequence) setBusy(false); }
  }, [t]);

  const saveToolGrants = useCallback(async (connection: Connection) => {
    const review = toolReviews[connection.id];
    if (!review || review.version !== connection.version) { setMessage(t.changed); return; }
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const sequence = ++generation.current; const timer = window.setTimeout(() => request.abort(), 25_000);
    setBusy(true); setMessage('');
    try {
      const selected = new Set(review.selected);
      const grants = review.tools.filter(tool => selected.has(tool.alias)).map(tool => ({ alias: tool.alias, fingerprint: tool.fingerprint }));
      const response = await fetch(`/api/mcp/connections/${encodeURIComponent(connection.id)}/grants`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Origin-MCP-Intent': 'manage' },
        body: JSON.stringify({ version: connection.version, grants }), signal: request.signal,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        if (result.code === 'MCP_TOOL_CATALOG_CHANGED') throw new Error(t.catalogChanged);
        if (result.code === 'MCP_CONNECTION_CHANGED') throw new Error(t.changed);
        throw new Error(t.error);
      }
      if (generation.current === sequence) setMessage(t.grantsSaved);
    } catch (error) {
      if (generation.current === sequence) {
        const allowed = [t.error, t.catalogChanged, t.changed];
        setMessage(error instanceof Error && allowed.includes(error.message) ? error.message : t.error);
      }
    } finally { window.clearTimeout(timer); if (generation.current === sequence) setBusy(false); }
  }, [t, toolReviews]);

  const login = useCallback(async () => {
    const email = emailInput.current?.value.trim() ?? '';
    const password = passwordInput.current?.value ?? '';
    if (passwordInput.current) passwordInput.current.value = '';
    if (!email || !password) { setMessage(t.loginFailed); return; }
    await run({ path: '/api/mcp/session/login', method: 'POST', body: { email, password }, success: t.signedIn });
  }, [run, t]);

  useEffect(() => {
    if (expanded) void run();
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [expanded, run]);

  const choices = overview?.servers ?? [];
  const connections = overview?.connections ?? [];
  const selectedServer = choices.find(server => server.id === selected);
  const ready = overview?.configured && overview.authenticated;
  const button = 'origin-secondary-button min-h-12 rounded-xl border px-3 text-sm font-semibold disabled:opacity-50';
  const input = 'origin-surface min-h-11 w-full rounded-xl border px-3 text-sm';

  return <section className="space-y-3 border-t border-[var(--border-default)] pt-5" onPointerDown={event => event.stopPropagation()}>
    <button type="button" className="flex min-h-12 w-full items-center justify-between text-left text-sm font-bold" aria-expanded={expanded} aria-controls="mcp-settings-content" onClick={() => setExpanded(value => !value)}>{t.title}<span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
    {expanded && <div id="mcp-settings-content" className="space-y-3" aria-busy={busy}>
      <p className="origin-muted text-sm">{t.help}</p>
      {busy && <p role="status" className="origin-muted text-sm">{t.loading}</p>}
      {overview && !overview.configured && <p className="origin-muted text-sm">{t.setup}</p>}
      {overview?.configured && !overview.authenticated && <div className="origin-surface-muted space-y-3 rounded-xl border p-3">
        <p className="text-sm font-semibold">{t.login}</p>
        <p className="origin-muted text-sm">{t.loginHelp}</p>
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); void login(); }}>
          <label htmlFor="mcp-owner-email" className="block text-sm font-semibold">{t.email}</label>
          <input ref={emailInput} id="mcp-owner-email" className={input} type="email" autoComplete="username" inputMode="email" disabled={busy} maxLength={320} required />
          <label htmlFor="mcp-owner-password" className="block text-sm font-semibold">{t.password}</label>
          <input ref={passwordInput} id="mcp-owner-password" className={input} type="password" autoComplete="current-password" disabled={busy} maxLength={4096} required />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={button} disabled={busy}>{t.signIn}</button>
            <button type="button" className={button} disabled={busy} onClick={() => void run({ path: '/api/mcp/session/refresh', method: 'POST', body: {}, success: t.restored })}>{t.restore}</button>
          </div>
        </form>
      </div>}
      {ready && <>
        <div className="flex justify-end"><button type="button" className={button} disabled={busy} onClick={() => void run({ path: '/api/mcp/session/logout', method: 'POST', body: {}, success: t.signedOut })}>{t.logout}</button></div>
        <McpGithubBootstrapSettings language={language} buttonClass={button} />
        <label htmlFor="mcp-server-choice" className="block text-sm font-semibold">{t.choose}</label>
        <div className="flex flex-wrap gap-2"><select id="mcp-server-choice" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setAuthorizationUrl(''); }} className="origin-surface min-h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm"><option value="">{t.select}</option>{choices.map(server => <option key={server.id} value={server.id}>{server.label}</option>)}</select>
        <button type="button" disabled={busy || !selectedServer} className={button} onClick={() => selectedServer?.authMode === 'oauth'
          ? void run({ path: `/api/mcp/oauth/${encodeURIComponent(selectedServer.id)}/start`, method: 'POST', body: {}, success: t.oauthReady, oauth: true })
          : void run({ path: '/api/mcp/connections', method: 'POST', body: { serverId: selected }, success: t.saved })}>{selectedServer?.authMode === 'oauth' ? t.oauth : t.add}</button></div>
        {authorizationUrl && <a className={`${button} inline-flex items-center`} href={authorizationUrl} rel="noreferrer">{t.oauthContinue}</a>}
        {connections.length === 0 && <p className="origin-muted text-sm">{t.empty}</p>}
        <ul className="space-y-3">{connections.map(connection => <li key={connection.id} className="origin-surface-muted space-y-2 rounded-xl border p-3">
          <p className="break-words text-sm font-semibold">{choices.find(s => s.id === connection.serverId)?.label ?? t.unknown}</p>
          <p className="origin-muted text-sm">{connection.status === 'verified' ? t.checked : connection.status === 'failed' ? t.unavailable : t.registered}</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void run({ path: `/api/mcp/connections/${encodeURIComponent(connection.id)}/check`, method: 'POST', body: { version: connection.version }, success: t.verified })}>{t.check}</button>
          {connection.status === 'verified' && <button type="button" className={button} disabled={busy} onClick={() => void reviewTools(connection)}>{t.reviewTools}</button>}
          <button type="button" className={button} disabled={busy} onClick={() => void run({ path: `/api/mcp/connections/${encodeURIComponent(connection.id)}`, method: 'DELETE', body: { version: connection.version }, success: t.removed })}>{t.remove}</button></div>
          {toolReviews[connection.id]?.version === connection.version && <div className="space-y-2 border-t border-[var(--border-default)] pt-2">
            <p className="origin-muted text-sm">{t.toolsHelp}</p>
            {toolReviews[connection.id].tools.length === 0 && <p className="origin-muted text-sm">{t.noTools}</p>}
            <div className="space-y-2">{toolReviews[connection.id].tools.map(tool => <label key={tool.alias} className="origin-surface flex items-start gap-2 rounded-lg border p-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={busy} checked={toolReviews[connection.id].selected.includes(tool.alias)} onChange={event => setToolReviews(current => {
                const review = current[connection.id]; if (!review) return current;
                const selected = new Set(review.selected); if (event.target.checked) selected.add(tool.alias); else selected.delete(tool.alias);
                return { ...current, [connection.id]: { ...review, selected: [...selected] } };
              })} />
              <span className="min-w-0"><span className="block break-words font-semibold">{tool.name}</span>{tool.description && <span className="origin-muted block break-words">{tool.description}</span>}</span>
            </label>)}</div>
            <button type="button" className={button} disabled={busy} onClick={() => void saveToolGrants(connection)}>{t.saveTools}</button>
          </div>}
        </li>)}</ul><p className="origin-muted text-sm">{t.notice}</p>
      </>}
      <p role="status" aria-live="polite" className="text-sm">{message}</p>
      <button type="button" className={button} disabled={busy} onClick={() => void run()}>{t.refresh}</button>
    </div>}
  </section>;
}
