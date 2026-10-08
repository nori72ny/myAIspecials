import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadCheckpointsFromIndexedDB, saveCheckpointToIndexedDB } from '../agent/indexedDbCheckpointStore';
import type { CheckpointState } from '../agent/checkpointManager';

type AgentCapability = {
  ready: boolean;
  approvalSigningConfigured: boolean;
  replayProtectionConfigured: boolean;
  replayProtection: string;
  freeOnly: boolean;
  costUsd: number;
  paidFallbackEnabled: boolean;
  codingBridgeConfigured?: boolean;
};

const tools = [
  'document_generator',
  'code_interpreter',
  'image_prompt_compiler',
  'web_search_grounding',
  'repository_explorer',
  'file_reader',
  'file_writer',
  'verification_runner',
] as const;
type AgentTool = (typeof tools)[number];
const isAgentTool = (value: unknown): value is AgentTool => typeof value === 'string' && tools.includes(value as AgentTool);

type AgentPlanStep = { id: string; title: string };
type AgentPlan = {
  runId: string;
  planToken: string;
  expiresAt: string;
  selectedTool: AgentTool;
  goal: string;
  plan: AgentPlanStep[];
};

type CodingVerificationCheck = {
  kind: 'test' | 'typecheck' | 'lint' | 'build';
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  attempt: number;
};

type CodingBridgeResult = {
  schemaVersion: 1;
  sessionStatus: 'verified' | 'blocked' | 'repair_limit';
  repairRounds: number;
  diffs: Array<{
    path: string;
    kind: 'modified' | 'created';
    before: string | null;
    after: string | null;
    beforeTruncated: boolean;
    afterTruncated: boolean;
    previewAvailable: boolean;
  }>;
  verificationChecks: CodingVerificationCheck[];
  freeOnly: true;
  costUsd: 0;
  gitPublished: false;
  deployed: false;
};

type AgentExecutionResponse = {
  ok?: boolean;
  code?: string;
  status?: string;
  runId?: string;
  freeOnly?: boolean;
  costUsd?: number;
  paidFallbackUsed?: boolean;
  artifact?: string;
  checkpoint?: CheckpointState;
  jobId?: string;
  bridgeToken?: string;
  expiresAt?: string;
  codingStatus?: string;
  verified?: boolean;
  result?: CodingBridgeResult;
};

type Phase = 'idle' | 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed';
type VerificationKind = 'test' | 'typecheck' | 'lint' | 'build';

function authorizationHeaders(credential: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` };
}

function explicitPathFromGoal(goal: string): string | null {
  const backtick = goal.match(/`([^`\r\n]{1,240})`/);
  if (backtick?.[1]) return backtick[1].trim();
  const quoted = goal.match(/["“]([^"”\r\n]{1,240})["”]/);
  if (quoted?.[1] && /[./]/.test(quoted[1])) return quoted[1].trim();
  const pathLike = goal.match(/(?:^|\s)((?:\.{0,2}\/)?[A-Za-z0-9_@./-]+\.[A-Za-z0-9_-]{1,12})(?=\s|$|[、。,:：])/);
  return pathLike?.[1]?.trim() || null;
}

function fencedContentFromGoal(goal: string): string | null {
  const fenced = goal.match(/```(?:[A-Za-z0-9_.+-]+)?\s*\n([\s\S]*?)```/);
  const content = fenced?.[1]?.trimEnd() ?? '';
  return content ? `${content}\n` : null;
}

function verificationKindFromGoal(goal: string): VerificationKind | null {
  const value = goal.normalize('NFKC').toLowerCase();
  const kinds: VerificationKind[] = [];
  if (/\btest(?:s|ing)?\b|テスト/.test(value)) kinds.push('test');
  if (/\btype[- ]?check(?:ing)?\b|型チェック/.test(value)) kinds.push('typecheck');
  if (/\blint(?:ing)?\b|リント/.test(value)) kinds.push('lint');
  if (/\bbuild(?:ing)?\b|ビルド/.test(value)) kinds.push('build');
  return kinds.length === 1 ? kinds[0] : null;
}

function paramsFor(tool: AgentTool, goal: string): Record<string, unknown> | null {
  if (tool === 'code_interpreter') return { goal };
  if (tool === 'document_generator') return { content: goal };
  if (tool === 'image_prompt_compiler') return { prompt: goal };
  if (tool === 'web_search_grounding') return null;
  if (tool === 'repository_explorer') return {};
  if (tool === 'file_reader') {
    const path = explicitPathFromGoal(goal);
    return path ? { path } : null;
  }
  if (tool === 'file_writer') {
    const path = explicitPathFromGoal(goal);
    const content = fencedContentFromGoal(goal);
    return path && content ? { path, content } : null;
  }
  const kind = verificationKindFromGoal(goal);
  return kind ? { kind } : null;
}

function phaseLabel(phase: Phase): string {
  if (phase === 'planning') return '計画を準備中';
  if (phase === 'awaiting_approval') return '承認待ち';
  if (phase === 'executing') return '実行・検証中';
  if (phase === 'completed') return '完了';
  if (phase === 'failed') return '安全に停止';
  return '待機中';
}

/**
 * The server validates the encrypted durable worker outcome, but a damaged,
 * stale or mismatched HTTP receipt must also be rejected by the UI. Do not
 * infer terminal success from status=completed alone or from four check labels.
 */
export function isVerifiedCodingReceipt(receipt: AgentExecutionResponse, runId: string, jobId: string): boolean {
  if (receipt?.ok !== true || receipt.status !== 'completed' || receipt.verified !== true
    || receipt.codingStatus !== 'verified' || receipt.runId !== runId || receipt.jobId !== jobId
    || receipt.freeOnly !== true || receipt.costUsd !== 0 || receipt.paidFallbackUsed !== false) return false;
  const result = receipt.result;
  if (!result || result.schemaVersion !== 1 || result.sessionStatus !== 'verified'
    || !Number.isInteger(result.repairRounds) || result.repairRounds < 0 || result.repairRounds > 3
    || result.freeOnly !== true || result.costUsd !== 0 || result.gitPublished !== false || result.deployed !== false) return false;
  if (!Array.isArray(result.diffs) || result.diffs.length < 1 || result.diffs.length > 12) return false;
  const paths = new Set<string>();
  for (const diff of result.diffs) {
    if (!diff || typeof diff.path !== 'string' || !diff.path || paths.has(diff.path)
      || !['created', 'modified'].includes(diff.kind)
      || typeof diff.beforeTruncated !== 'boolean' || typeof diff.afterTruncated !== 'boolean'
      || typeof diff.previewAvailable !== 'boolean'
      || !(diff.before === null || typeof diff.before === 'string')
      || !(diff.after === null || typeof diff.after === 'string')) return false;
    paths.add(diff.path);
  }
  const checks = result.verificationChecks;
  const required = ['typecheck', 'lint', 'test', 'build'];
  return Array.isArray(checks) && checks.length === 4
    && new Set(checks.map(check => check?.kind)).size === 4
    && required.every(kind => checks.some(check => check?.kind === kind
      && check.ok === true && check.exitCode === 0 && check.timedOut === false
      && check.attempt === result.repairRounds));
}

export function verifiedCodingArtifact(result: CodingBridgeResult): string {
  const requiredKinds = ['typecheck', 'lint', 'test', 'build'] as const;
  const checks = requiredKinds.map((kind) => {
    const check = result.verificationChecks.find((item) => item.kind === kind);
    return `- ${kind}: ${check?.ok && check.exitCode === 0 && !check.timedOut ? 'PASS' : 'FAIL / no proof'}`;
  }).join('\n');
  const summaries = result.diffs.map((diff) => `- ${diff.path} (${diff.kind})`).join('\n') || '- 変更ファイルなし';

  // The trusted server already bounds and sanitizes each preview. Render as
  // literal text in the workspace <pre>, never as HTML, executable code or a
  // complete source file. Missing/truncated previews are not task completion.
  const previews = result.diffs.map((diff, index) => {
    if (!diff.previewAvailable) {
      return `### ${index + 1}. ${diff.path}\n\n変更内容のプレビューを取得できません。元ファイルや完全な差分を推測しません。`;
    }
    const before = diff.before === null ? '（新規ファイル）' : diff.before;
    const after = diff.after === null ? '（変更後の内容を取得できません）' : diff.after;
    const beforeLabel = diff.beforeTruncated ? '変更前（一部省略）' : '変更前';
    const afterLabel = diff.afterTruncated ? '変更後（一部省略）' : '変更後';
    return [
      `### ${index + 1}. ${diff.path}`,
      `[${beforeLabel}]`,
      before,
      `[${afterLabel}]`,
      after,
    ].join('\n');
  }).join('\n\n');

  return [
    '# Coding V1.4 検証済み結果',
    '',
    '作業環境内でのコード変更と検証が完了しました。GitHubへの反映・本番公開は行っていません。',
    '',
    `Repair rounds: ${result.repairRounds}`,
    '',
    '## Changed paths',
    summaries,
    '',
    '## Verification',
    checks,
    '',
    '## 変更内容のプレビュー',
    '表示内容は最大サイズが制限された確認用抜粋です。完全なGit差分・デプロイ済みコードを意味しません。',
    previews || '表示可能な差分はありません。',
    '',
    'Git publish: not authorized',
    'Deploy: not authorized',
    'Cost: $0',
  ].join('\n');
}

function waitForCodingPoll(signal: AbortSignal, delayMs = 2500): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export default function AgentWorkspaceView() {
  const [goal, setGoal] = useState('');
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(true);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [artifact, setArtifact] = useState('// Agent v3 の検証済み出力がここに表示されます。');
  const [checkpoints, setCheckpoints] = useState<CheckpointState[]>([]);
  const [restoring, setRestoring] = useState(true);
  const credentialInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // An ephemeral, run-bound cancellation capability. Never persisted to a browser store.
  const [activeCoding, setActiveCoding] = useState<{ runId: string; jobId: string; bridgeToken: string } | null>(null);
  const [codingCancelPending, setCodingCancelPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setCheckingCapability(true);
    void fetch('/api/agent/v3/status', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as Partial<AgentCapability>;
        if (!response.ok) throw new Error('AGENT_STATUS_UNAVAILABLE');
        setCapability({
          ready: data.ready === true,
          approvalSigningConfigured: data.approvalSigningConfigured === true,
          replayProtectionConfigured: data.replayProtectionConfigured === true,
          replayProtection: typeof data.replayProtection === 'string' ? data.replayProtection : 'unavailable',
          freeOnly: data.freeOnly === true,
          costUsd: typeof data.costUsd === 'number' ? data.costUsd : -1,
          paidFallbackEnabled: data.paidFallbackEnabled === true,
          codingBridgeConfigured: data.codingBridgeConfigured === true,
        });
      })
      .catch(() => setCapability(null))
      .finally(() => setCheckingCapability(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadCheckpointsFromIndexedDB()
      .then((restored) => { if (mounted) setCheckpoints(restored); })
      .catch(() => { if (mounted) setLog((current) => [...current, '端末内のAgent履歴を読み込めませんでした。']); })
      .finally(() => { if (mounted) setRestoring(false); });
    return () => {
      mounted = false;
      abortRef.current?.abort();
      if (credentialInputRef.current) credentialInputRef.current.value = '';
    };
  }, []);

  const persistCheckpoint = useCallback(async (checkpoint: CheckpointState) => {
    setCheckpoints((current) => [...current.filter((item) => item.checkpointId !== checkpoint.checkpointId), checkpoint].sort((a, b) => a.createdAt - b.createdAt));
    try { await saveCheckpointToIndexedDB(checkpoint); }
    catch { setLog((current) => [...current, 'チェックポイントはこのセッションでは利用できますが、端末保存を確認できませんでした。']); }
  }, []);

  const requestPlan = useCallback(async () => {
    const trimmed = goal.trim();
    if (!trimmed || phase === 'planning' || phase === 'executing' || capability?.ready !== true) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlan(null);
    setPhase('planning');
    setLog(['Agent v3: 実行計画を準備しています。']);
    setArtifact('// Plan preparing…');
    try {
      const response = await fetch('/api/agent/v3/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ goal: trimmed }),
        signal: controller.signal,
      });
      const data = await response.json() as Partial<AgentPlan> & { ok?: boolean; code?: string };
      if (!response.ok || data.ok !== true || typeof data.runId !== 'string' || typeof data.planToken !== 'string' || !Array.isArray(data.plan) || !isAgentTool(data.selectedTool)) {
        throw new Error(data.code ?? 'AGENT_PLAN_FAILED');
      }
      const next: AgentPlan = {
        runId: data.runId,
        planToken: data.planToken,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
        selectedTool: data.selectedTool,
        goal: trimmed,
        plan: data.plan.filter((step): step is AgentPlanStep => Boolean(step) && typeof step.id === 'string' && typeof step.title === 'string').slice(0, 12),
      };
      setPlan(next);
      setPhase('awaiting_approval');
      setArtifact([
        '# Agent v3 実行計画',
        '',
        `Goal: ${next.goal}`,
        `Tool: ${next.selectedTool}`,
        '',
        ...next.plan.map((step, index) => `${index + 1}. ${step.title}`),
        '',
        '実行には、計画に署名された1つの登録済みツールに限定した認証付き承認が必要です。',
        '承認トークンはそのrun・tool・paramsだけに有効で、再利用はできません。',
      ].join('\n'));
      setLog((current) => [...current, `計画を作成しました。署名済みツール: ${next.selectedTool}。まだツールは実行していません。`]);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, `計画を作成できませんでした: ${(error as Error).message}`]);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [capability?.ready, goal, phase]);

  const approveAndExecute = useCallback(async () => {
    if (!plan || phase !== 'awaiting_approval') return;
    const credential = credentialInputRef.current?.value.trim() ?? '';
    if (!credential) {
      setLog((current) => [...current, '実行にはAgent認証キーが必要です。キーは端末へ保存しません。']);
      credentialInputRef.current?.focus();
      return;
    }
    if (plan.expiresAt && Date.parse(plan.expiresAt) <= Date.now()) {
      setPlan(null);
      setPhase('failed');
      setLog((current) => [...current, '計画の承認期限が切れました。新しい計画を作成してください。']);
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      return;
    }

    const toolParams = paramsFor(plan.selectedTool, plan.goal);
    if (!toolParams) {
      setPhase('failed');
      setLog((current) => [...current, `計画ツール ${plan.selectedTool} に必要な明示パラメータが不足しているため、承認前に停止しました。`]);
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('executing');
    setLog((current) => [...current, `承認対象: ${plan.selectedTool}`, 'exact-operation approvalを取得しています。']);
    try {
      const approvalResponse = await fetch('/api/agent/v3/approval', {
        method: 'POST',
        headers: authorizationHeaders(credential),
        cache: 'no-store',
        body: JSON.stringify({
          runId: plan.runId,
          planToken: plan.planToken,
          toolName: plan.selectedTool,
          params: toolParams,
        }),
        signal: controller.signal,
      });
      const approval = await approvalResponse.json() as { ok?: boolean; approvalToken?: string; code?: string };
      if (!approvalResponse.ok || approval.ok !== true || typeof approval.approvalToken !== 'string') {
        throw new Error(approval.code ?? 'AGENT_APPROVAL_FAILED');
      }

      const executeResponse = await fetch('/api/agent/v3/execute', {
        method: 'POST',
        headers: authorizationHeaders(credential),
        cache: 'no-store',
        body: JSON.stringify({
          runId: plan.runId,
          toolName: plan.selectedTool,
          params: toolParams,
          approvalToken: approval.approvalToken,
        }),
        signal: controller.signal,
      });
      const result = await executeResponse.json() as AgentExecutionResponse;

      if (plan.selectedTool === 'code_interpreter') {
        if (
          executeResponse.status !== 202
          || result.ok !== true
          || result.status !== 'running'
          || typeof result.jobId !== 'string'
          || typeof result.bridgeToken !== 'string'
          || typeof result.expiresAt !== 'string'
        ) {
          throw new Error(result.code ?? 'AGENT_CODING_DISPATCH_FAILED');
        }

        if (credentialInputRef.current) credentialInputRef.current.value = '';
        setActiveCoding({ runId: plan.runId, jobId: result.jobId, bridgeToken: result.bridgeToken });
        setArtifact([
          '# Coding V1.4',
          '',
          'コード変更ジョブを開始しました。',
          '検証済みの終端結果が届くまで完了扱いにはしません。',
          '',
          `Job: ${result.jobId}`,
        ].join('\n'));
        setLog((current) => [...current, `Coding V1.4 job started: ${result.jobId}`, 'typecheck / lint / test / build の検証完了を待っています。']);

        const expiresAt = Date.parse(result.expiresAt);
        if (!Number.isFinite(expiresAt)) throw new Error('AGENT_CODING_BRIDGE_EXPIRY_INVALID');
        let lastStatus = '';
        while (Date.now() < expiresAt) {
          const pollResponse = await fetch('/api/agent/v3/coding/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({
              runId: plan.runId,
              jobId: result.jobId,
              bridgeToken: result.bridgeToken,
            }),
            signal: controller.signal,
          });
          const poll = await pollResponse.json() as AgentExecutionResponse;
          if (!pollResponse.ok || poll.ok !== true) {
            throw new Error(poll.code ?? 'AGENT_CODING_STATUS_FAILED');
          }
          if (poll.status === 'completed') {
            if (!isVerifiedCodingReceipt(poll, plan.runId, result.jobId) || !poll.result) {
              throw new Error('AGENT_CODING_RECEIPT_INVALID');
            }
            setArtifact(verifiedCodingArtifact(poll.result));
            setPhase('completed');
            setActiveCoding(null);
            setLog((current) => [...current, 'Coding V1.4 の最終4検証が完了しました。完了状態へ移行します。']);
            setPlan(null);
            return;
          }
          if (poll.status !== 'running') throw new Error(poll.code ?? 'AGENT_CODING_TERMINAL_UNVERIFIED');
          if (poll.codingStatus && poll.codingStatus !== lastStatus) {
            lastStatus = poll.codingStatus;
            setLog((current) => [...current, `Coding status: ${poll.codingStatus}`]);
          }
          await waitForCodingPoll(controller.signal);
        }
        throw new Error('AGENT_CODING_BRIDGE_EXPIRED');
      }

      if (!executeResponse.ok || result.ok !== true || result.status !== 'completed' || typeof result.artifact !== 'string') {
        throw new Error(result.code ?? 'AGENT_EXECUTION_FAILED');
      }
      setArtifact(result.artifact);
      if (result.checkpoint) await persistCheckpoint(result.checkpoint);
      setPhase('completed');
      setLog((current) => [...current, '登録済みツールの実行と検証が完了しました。', result.checkpoint ? `Checkpoint: ${result.checkpoint.checkpointId}` : '']);
      setPlan(null);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, `実行は完了扱いにしていません: ${(error as Error).message}`]);
      }
    } finally {
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [persistCheckpoint, phase, plan]);

  const cancelActiveCoding = useCallback(async () => {
    if (!activeCoding || codingCancelPending) return;
    setCodingCancelPending(true);
    try {
      const response = await fetch('/api/agent/v3/coding/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(activeCoding),
      });
      const result = await response.json() as { ok?: boolean; status?: string; code?: string };
      if (!response.ok || result.ok !== true || !['cancelling', 'cancelled'].includes(result.status ?? '')) {
        throw new Error(result.code ?? 'AGENT_CODING_CANCEL_FAILED');
      }
      setLog((current) => [...current, result.status === 'cancelled'
        ? 'Codingジョブはサーバー側で中止されました。完了扱いにはしません。'
        : 'Codingジョブの中止要求をサーバー側で受理しました。終端状態の確認中です。']);
      if (result.status === 'cancelled') {
        abortRef.current?.abort();
        setPhase('failed');
        setActiveCoding(null);
      }
    } catch (error) {
      setLog((current) => [...current, `Codingジョブの中止を確認できません: ${(error as Error).message}。ブラウザを閉じてもサーバー処理は停止したとは限りません。`]);
    } finally {
      setCodingCancelPending(false);
    }
  }, [activeCoding, codingCancelPending]);

  const resetPlan = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPlan(null);
    setPhase('idle');
    setLog((current) => [...current, '計画をリセットしました。未承認の操作は実行していません。']);
    if (credentialInputRef.current) credentialInputRef.current.value = '';
  };

  const restoreLocalCheckpoint = (checkpoint: CheckpointState) => {
    setArtifact(checkpoint.artifact);
    setLog((current) => [...current, `端末内のチェックポイント ${checkpoint.checkpointId} を表示しました。サーバー側の変更を巻き戻したとは主張しません。`]);
  };

  const ready = capability?.ready === true
    && capability.freeOnly === true
    && capability.costUsd === 0
    && capability.paidFallbackEnabled === false;
  const plannedParamsReady = plan ? paramsFor(plan.selectedTool, plan.goal) !== null : false;

  return <section className="min-h-full bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-5" aria-label="Agent Workspace">
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.35fr)]">
      <aside className="origin-workspace rounded-2xl p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-500">Agent v3</p>
        <h1 className="mt-1 text-xl font-black">エージェントに任せる</h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">計画を確認してから、署名済み計画に固定された1つの登録済みツールだけを実行・検証します。</p>

        <label htmlFor="agent-goal" className="mt-4 block text-sm font-bold">達成したいこと</label>
        <textarea id="agent-goal" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={4000}
          disabled={phase === 'planning' || Boolean(plan) || phase === 'executing'}
          placeholder="例: この要件を整理して、実行可能な文書案を作ってください。"
          className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950" />

        <div role="status" className="mt-3 flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-500">{checkingCapability ? 'Agent基盤を確認中…' : ready ? 'Agent v3 基盤を確認済み' : 'Agent v3 は現在利用できません'}</span>
          <span className={ready ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'font-bold text-amber-700 dark:text-amber-300'}>
            {checkingCapability ? '確認中' : ready ? phaseLabel(phase) : 'Fail-closed'}
          </span>
        </div>

        <button type="button" onClick={() => void requestPlan()} disabled={!ready || !goal.trim() || Boolean(plan) || phase === 'planning' || phase === 'executing'}
          className="origin-primary-button mt-3 min-h-11 w-full rounded-xl px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {phase === 'planning' ? '計画中…' : '実行計画を作る'}
        </button>

        {plan && <section className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800" aria-label="Agent plan">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black">実行フロー</h2>
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">未実行 · 承認待ち</span>
          </div>
          <ol className="mt-2 space-y-2 pl-5 text-sm">{plan.plan.map((step) => <li key={step.id}>{step.title}</li>)}</ol>

          <p className="mt-4 block text-xs font-bold text-slate-500">計画で固定されたツール</p>
          <div aria-label="計画で固定されたツール" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900">
            {plan.selectedTool}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">このツール名は署名済みplan tokenに結び付いています。依頼内容を変える場合は計画を破棄して作り直します。</p>
          {!plannedParamsReady && <p role="alert" className="mt-2 text-xs font-semibold leading-5 text-amber-700 dark:text-amber-300">この操作には明示パス・内容・検証種別などの安全な実行パラメータが不足しています。依頼文を具体化して計画を作り直してください。</p>}

          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold">実行に必要な認証</summary>
            <p className="mb-2 text-xs leading-5 text-slate-500">Agent実行時だけ使用します。ブラウザ保存・localStorage保存はしません。</p>
            <input ref={credentialInputRef} id="agent-operator-key" aria-label="Agent認証キー" type="password" autoComplete="off" spellCheck={false}
              placeholder="Agent operator key"
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </details>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void approveAndExecute()} disabled={phase !== 'awaiting_approval' || !plannedParamsReady}
              className="min-h-11 rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm font-bold text-emerald-900 disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-200">
              承認して実行
            </button>
            <button type="button" onClick={resetPlan} disabled={phase === 'executing'} className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{phase === 'executing' ? '実行中' : '計画を破棄'}</button>
          </div>
          {activeCoding && <button type="button" onClick={() => void cancelActiveCoding()} disabled={codingCancelPending}
            className="origin-secondary-button mt-3 min-h-11 w-full rounded-xl border border-amber-300 px-4 text-sm font-semibold disabled:opacity-50"
            aria-label="実行中のCodingジョブを中止">
            {codingCancelPending ? '中止を確認中…' : '実行中のCodingジョブを中止'}
          </button>}
        </section>}

        <details className="mt-4 border-t border-slate-200 pt-2 text-xs dark:border-slate-800">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">安全境界</summary>
          <p className="leading-5 text-slate-500">署名済み計画、exact-operation承認、共有リプレイ防止、$0・有料fallback禁止を満たさない実行は停止します。画面に「完了」と出すのは検証済み成果だけです。</p>
          {capability && <div className="mt-2 space-y-1 text-slate-500">
            <p>Approval signing: {capability.approvalSigningConfigured ? 'ready' : 'unavailable'}</p>
            <p>Replay protection: {capability.replayProtectionConfigured ? capability.replayProtection : 'unavailable'}</p>
            <p>Coding bridge: {capability.codingBridgeConfigured ? 'available' : 'disabled'}</p>
          </div>}
        </details>

        <div className="mt-4 max-h-36 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-xs text-slate-300" aria-label="Agent log">
          {log.length ? log.filter(Boolean).map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : '実行ログはここに表示されます。'}
        </div>
      </aside>

      <main className="origin-workspace min-h-[28rem] overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Verified output</p><h2 className="font-bold">作業結果</h2></div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs dark:border-slate-700">$0 · permission gated</span>
        </div>
        <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap p-5 font-mono text-sm leading-6">{artifact}</pre>

        <section className="border-t border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-black">端末内チェックポイント</h3>
          {restoring ? <p className="mt-2 text-xs text-slate-500">読み込み中…</p> : checkpoints.length === 0
            ? <p className="mt-2 text-xs text-slate-500">検証済み実行が完了するとここに保存されます。</p>
            : <div className="mt-2 flex flex-wrap gap-2">{checkpoints.slice().reverse().slice(0, 8).map((item) =>
              <button type="button" key={item.checkpointId} onClick={() => restoreLocalCheckpoint(item)}
                className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-semibold">
                v{item.version} · {item.status}
              </button>)}</div>}
        </section>
      </main>
    </div>
  </section>;
}
