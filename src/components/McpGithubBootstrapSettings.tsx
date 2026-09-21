import { useCallback, useEffect, useState } from 'react';

type Status = { configured: boolean; registered: boolean; authenticated?: boolean; appSlug?: string };
type Approval = { actionUrl: string; manifest: string };

const copy = {
  ja: {
    title: 'GitHub App 初期設定',
    help: 'ORIGIN用の読み取り専用GitHub Appを、GitHub公式画面でオーナー承認して作成します。作成はこの画面の操作だけでは完了しません。',
    unavailable: 'GitHub App初期設定はまだ有効化されていません。',
    registered: 'GitHub Appは登録済みです。',
    prepare: 'GitHub承認を準備',
    approve: 'GitHubで内容を確認して作成',
    prepared: 'GitHub公式画面へ送る内容を検証しました。ボタンを押すとGitHubへ移動します。',
    error: 'GitHub App初期設定を準備できませんでした。再読み込みしてお試しください。',
    security: '権限はリポジトリ内容の読み取りのみ。Webhook・イベント・インストール時OAuthは無効です。',
  },
  en: {
    title: 'GitHub App setup',
    help: 'Create ORIGIN’s read-only GitHub App only after owner approval on GitHub’s official screen. This page does not create the app by itself.',
    unavailable: 'GitHub App setup is not enabled yet.',
    registered: 'The GitHub App is registered.',
    prepare: 'Prepare GitHub approval',
    approve: 'Review and create on GitHub',
    prepared: 'The payload for GitHub has been verified. Continue only if you want to approve it on GitHub.',
    error: 'Could not prepare GitHub App setup. Refresh and try again.',
    security: 'Repository contents are read-only. Webhooks, events, and OAuth-on-install are disabled.',
  },
};

function parseStatus(value: unknown): Status {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const v = value as Record<string, unknown>;
  if (typeof v.configured !== 'boolean' || typeof v.registered !== 'boolean') throw new Error();
  if (v.authenticated !== undefined && typeof v.authenticated !== 'boolean') throw new Error();
  if (v.appSlug !== undefined && (typeof v.appSlug !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(v.appSlug))) throw new Error();
  return { configured: v.configured, registered: v.registered, authenticated: v.authenticated as boolean | undefined, appSlug: v.appSlug as string | undefined };
}

function parseApproval(value: unknown): Approval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const v = value as Record<string, unknown>;
  if (v.ok !== true || typeof v.actionUrl !== 'string' || v.actionUrl.length > 2048 || typeof v.manifest !== 'string' || v.manifest.length > 16_384) throw new Error();
  const action = new URL(v.actionUrl);
  const keys = [...action.searchParams.keys()];
  const state = action.searchParams.get('state') ?? '';
  if (action.protocol !== 'https:' || action.hostname !== 'github.com' || action.pathname !== '/settings/apps/new'
    || action.username || action.password || action.hash || keys.length !== 1 || keys[0] !== 'state' || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new Error();
  const manifest = JSON.parse(v.manifest) as Record<string, unknown>;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error();
  const permissions = manifest.default_permissions;
  const hook = manifest.hook_attributes;
  if (manifest.public !== false || manifest.request_oauth_on_install !== false || !Array.isArray(manifest.default_events) || manifest.default_events.length !== 0
    || !permissions || typeof permissions !== 'object' || Array.isArray(permissions)
    || Object.keys(permissions as Record<string, unknown>).length !== 1 || (permissions as Record<string, unknown>).contents !== 'read'
    || !hook || typeof hook !== 'object' || Array.isArray(hook) || (hook as Record<string, unknown>).active !== false) throw new Error();
  return { actionUrl: action.href, manifest: v.manifest };
}

export default function McpGithubBootstrapSettings({ language, buttonClass }: { language: 'ja' | 'en'; buttonClass: string }) {
  const t = copy[language];
  const [status, setStatus] = useState<Status | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setMessage(''); setApproval(null);
    try {
      const response = await fetch('/api/mcp/github/app/status', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error();
      setStatus(parseStatus(await response.json()));
    } catch { setStatus(null); setMessage(t.error); }
    finally { setBusy(false); }
  }, [t.error]);

  const prepare = useCallback(async () => {
    setBusy(true); setMessage(''); setApproval(null);
    try {
      const response = await fetch('/api/mcp/github/app/manifest/start', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Origin-MCP-Intent': 'manage' },
        body: '{}',
      });
      const result = await response.json();
      if (!response.ok) throw new Error();
      setApproval(parseApproval(result));
      setMessage(t.prepared);
    } catch { setMessage(t.error); }
    finally { setBusy(false); }
  }, [t.error, t.prepared]);

  useEffect(() => { void load(); }, [load]);

  return <section className="origin-surface-muted space-y-2 rounded-xl border p-3" aria-busy={busy}>
    <p className="text-sm font-semibold">{t.title}</p>
    <p className="origin-muted text-sm">{t.help}</p>
    <p className="origin-muted text-sm">{t.security}</p>
    {status && !status.configured && <p className="origin-muted text-sm">{t.unavailable}</p>}
    {status?.registered && <p className="text-sm">{t.registered}{status.appSlug ? ` (${status.appSlug})` : ''}</p>}
    {status?.configured && !status.registered && status.authenticated !== false && !approval && <button type="button" className={buttonClass} disabled={busy} onClick={() => void prepare()}>{t.prepare}</button>}
    {approval && <form method="post" action={approval.actionUrl}>
      <input type="hidden" name="manifest" value={approval.manifest} />
      <button type="submit" className={buttonClass} disabled={busy}>{t.approve}</button>
    </form>}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </section>;
}
