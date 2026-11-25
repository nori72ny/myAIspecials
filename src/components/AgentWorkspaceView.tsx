import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OriginCatState, { type OriginCatStateKind } from './OriginCatState';
import AgentTaskBoard from './AgentTaskBoard';
import { getSessionCredential } from '../security/sessionCredentials';
import AgentLivePanel, { AgentResearchSourceCards, parseAgentResearchArtifact } from './AgentLivePanel';
import FormattedMarkdown from './FormattedMarkdown';
import { loadCheckpointsFromIndexedDB, saveCheckpointToIndexedDB } from '../agent/indexedDbCheckpointStore';
import type { CheckpointState } from '../agent/checkpointManager';
import {
  AGENT_RUN_SMALL_ADVANCE_BUDGET_MS,
  createAgentRunRecord,
  driveAgentRun,
  fetchAgentRunView,
  type AgentRunAuth,
  type AgentRunView,
} from '../agent/agentRunClient';
import { X } from 'lucide-react';
import { reportAgentActivity, type AgentActivityStepStatus } from '../agent/agentActivityStore';
import { detectSensitiveInput } from '../lib/orchestration/SensitiveInputDetector';

type AgentCapability = {
  ready: boolean;
  approvalSigningConfigured: boolean;
  replayProtectionConfigured: boolean;
  browserApprovalEnabled: boolean;
  attachmentsEnabled: boolean;
  freeOnly: boolean;
  costUsd: number;
  paidFallbackEnabled: boolean;
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
  'attachment_reader',
  'attachment_analyzer',
] as const;
type AgentTool = (typeof tools)[number];
const isAgentTool = (value: unknown): value is AgentTool => typeof value === 'string' && tools.includes(value as AgentTool);

type AgentPlanStep = { id: string; title: string };
type AgentToolStep = { toolName: AgentTool; params: Record<string, unknown> };
// The attachment summary a plan was bound to (file-input foundation
// F3, design §1.2): names and counts only — the bodies never come
// back to this screen. Shown in the plan so the approver can see the
// data itself is part of what the approval covers.
type AgentPlanAttachments = {
  fileCount: number;
  totalChars: number;
  files: Array<{ name: string; charCount: number }>;
};
type AgentPlan = {
  runId: string;
  planToken: string;
  expiresAt: string;
  selectedTool: AgentTool;
  params: Record<string, unknown>;
  steps: AgentToolStep[];
  goal: string;
  plan: AgentPlanStep[];
  attachments?: AgentPlanAttachments;
};

function parsePlanAttachments(value: unknown): AgentPlanAttachments | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.fileCount !== 'number' || typeof record.totalChars !== 'number' || !Array.isArray(record.files)) return undefined;
  const files: AgentPlanAttachments['files'] = [];
  for (const raw of record.files) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const file = raw as Record<string, unknown>;
    if (typeof file.name === 'string' && typeof file.charCount === 'number') files.push({ name: file.name, charCount: file.charCount });
  }
  return { fileCount: record.fileCount, totalChars: record.totalChars, files };
}

// 'held' and 'recorded' are the runs-path end states (PR-D2/D3): the
// work now lives in the durable record on the task board, not in this
// screen's stateless execution.
type Phase = 'idle' | 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed' | 'held' | 'recorded';

// The runs path returns no checkpoint object (PR-D1 delivers only the
// artifact body), so the on-device save is a local record built from
// the run id and the delivered body. It carries no file mutation, so
// it can be redisplayed from this screen but never rolled back to.
// The title is fixed at save time from the request text: a research
// artifact is a sources JSON with no headline of its own, so the
// request is the only text that identifies what the result was for.
function localRunCheckpoint(runId: string, artifact: string, title?: string): CheckpointState {
  return {
    checkpointId: `${runId}-runs-v1`,
    taskId: runId,
    executionId: 'agent-run',
    version: 1,
    status: 'completed',
    artifact,
    createdAt: Date.now(),
    ...(title ? { title } : {}),
  };
}
type VerificationKind = 'test' | 'typecheck' | 'lint' | 'build';

// One execution shown in the live panel (agent live view PR-L2). The
// step snapshot and the owner binding are kept in memory only, like
// every other credential in this screen, so the panel can keep
// following the recorded run after this screen's driving stops.
type LiveSession = {
  runId: string;
  steps: AgentToolStep[];
  auth: AgentRunAuth;
};

const AGENT_RUN_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const AGENT_RUN_LIVE_POLL_INTERVAL_MS = 5000;

function authorizationHeaders(credential: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` };
}

function toolLabel(tool: AgentTool): string {
  const labels: Record<AgentTool, string> = {
    document_generator: '文書を作る',
    code_interpreter: 'コードを作って確認する',
    image_prompt_compiler: '画像を作るための指示文を作る',
    web_search_grounding: 'ウェブで調べる',
    repository_explorer: 'ファイルの一覧を見る',
    file_reader: 'ファイルを読む',
    file_writer: 'ファイルを作る・直す',
    verification_runner: 'テストと動作確認',
    attachment_reader: '添付データを読む',
    attachment_analyzer: 'データを読み解いて処理する',
  };
  return labels[tool];
}

function hasExecutableParams(tool: AgentTool, params: Record<string, unknown>): boolean {
  if (tool === 'web_search_grounding') return typeof params.query === 'string' && params.query.trim().length > 0;
  if (tool === 'file_writer') {
    if (typeof params.path !== 'string' || params.path.trim().length === 0) return false;
    return (typeof params.content === 'string' && params.content.length > 0)
      || params.contentFromPreviousArtifact === true
      || typeof params.contentFromStep === 'number';
  }
  if (tool === 'attachment_reader') {
    return typeof params.attachmentSetId === 'string' && params.attachmentSetId.trim().length > 0
      && typeof params.setDigest === 'string' && params.setDigest.trim().length > 0;
  }
  if (tool === 'attachment_analyzer') {
    return typeof params.attachmentSetId === 'string' && params.attachmentSetId.trim().length > 0
      && typeof params.setDigest === 'string' && params.setDigest.trim().length > 0
      && typeof params.chunkCount === 'number' && params.chunkCount > 0;
  }
  if (tool === 'file_reader') return typeof params.path === 'string' && params.path.trim().length > 0;
  if (tool === 'verification_runner') return ['test', 'typecheck', 'lint', 'build'].includes(String(params.kind));
  if (tool === 'image_prompt_compiler') return typeof params.prompt === 'string' && params.prompt.trim().length > 0;
  if (tool === 'document_generator') {
    return (typeof params.title === 'string' && params.title.trim().length > 0)
      || (typeof params.content === 'string' && params.content.trim().length > 0);
  }
  if (tool === 'code_interpreter') {
    if (params.mode === 'provided-code') return typeof params.code === 'string' && params.code.trim().length > 0;
    if (params.mode === 'generate') return typeof params.instruction === 'string' && params.instruction.trim().length > 0;
    return typeof params.code === 'string' && params.code.trim().length > 0;
  }
  return tool === 'repository_explorer';
}

function hasExecutableSteps(plan: AgentPlan): boolean {
  return plan.steps.length > 0 && plan.steps.every((step) => hasExecutableParams(step.toolName, step.params));
}

// Attachment intake (file-input foundation F3, design §1.3, §2.2).
// The limits repeat the server's numbers (agentAttachmentRecord.ts)
// instead of importing them: that module is server-side, and this
// screen runs in the browser. The server re-checks every limit (and
// the secret screening) on upload, so these local checks only spare
// the round trip — a file over a limit is refused whole, with the
// numbers shown, never truncated into compliance (design §4.3). The
// kind rule mirrors the chat's isTextLike, with tsv named explicitly
// as the design requires for the agent side.
const MAX_AGENT_ATTACHMENT_FILE_CHARS = 200_000;
const MAX_AGENT_ATTACHMENT_FILES = 10;
const MAX_AGENT_ATTACHMENT_TOTAL_CHARS = 500_000;
const AGENT_ATTACHMENT_TEXT_EXTENSIONS = /\.(txt|csv|tsv|md|json)$/i;

function isAgentAttachmentTextLike(file: File): boolean {
  return file.type.startsWith('text/')
    || file.type === 'application/json'
    || AGENT_ATTACHMENT_TEXT_EXTENSIONS.test(file.name);
}

type AgentAttachmentChip = { name: string; charCount: number };

export function catStateForPhase(phase: Phase, checkingCapability: boolean, ready: boolean): OriginCatStateKind {
  if (checkingCapability) return 'thinking';
  if (!ready) return 'sorry';
  if (phase === 'planning') return 'thinking';
  if (phase === 'awaiting_approval') return 'waiting';
  if (phase === 'executing') return 'working';
  if (phase === 'completed') return 'done';
  if (phase === 'failed') return 'sorry';
  if (phase === 'held') return 'waiting';
  if (phase === 'recorded') return 'working';
  return 'sleep';
}

function checkpointStatusLabel(status: string): string {
  if (status === 'completed') return '完了';
  if (status === 'self_fixed') return '修正済み';
  if (status === 'rolled_back') return '巻き戻し済み';
  return '保存済み';
}

/** 保存した結果の日時表記（タスクボードと同じ M/D HH:mm 形式）。 */
function formatSavedResultDate(createdAt: number): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * 保存した結果の見出し。結果本文の最初の行（Markdown の見出し記号は
 * 外す）をそのまま使う。本文が JSON のときは生データを出さず null。
 */
function artifactHeadline(artifact: string): string | null {
  const trimmed = artifact.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    if (line) return line.length > 60 ? `${line.slice(0, 60)}…` : line;
  }
  return null;
}

/**
 * 保存時に依頼文から作る見出し。依頼文を1行に整え、長すぎる場合は
 * artifactHeadline と同じ60字で省略する。依頼文が空なら持たせない
 * （undefined を返し、表示は従来の導出に落ちる）。
 */
function savedResultTitle(goal: string): string | undefined {
  const line = goal.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

/**
 * 保存した結果1件の表示内容。状態語だけが並ばないよう、結果の中身
 * から分かる「何の結果か・いつ・成果物」を一対一に組み立てる。
 * 記録に無い項目は作らず、行ごと省く（捏造しない）。
 * 見出しは、保存時に依頼文から作った題名があればそれを使い、
 * 無い記録（旧形式）は従来どおり本文からの導出に落ちる。
 */
function savedResultView(item: CheckpointState): { title: string; meta: string; status: string } {
  const research = parseAgentResearchArtifact(item.artifact);
  const storedTitle = typeof item.title === 'string' ? item.title.trim() : '';
  const title = storedTitle || (research ? '調査の結果' : artifactHeadline(item.artifact) ?? '作業の結果');
  const meta = [
    formatSavedResultDate(item.createdAt),
    ...(research ? [`出典${research.sources.length}件`] : []),
    ...(item.mutation?.path ? [item.mutation.path] : []),
  ].filter(Boolean).join(' · ');
  return { title, meta, status: checkpointStatusLabel(item.status) };
}

// 作業結果欄の初期値。実際の結果が入るまでは、この文字列との一致で
// 「まだ結果が無い」空状態を判定する（結果として保存されることはない）。
const ARTIFACT_PLACEHOLDER = '終わると、結果がここに表示されます。';

function phaseLabel(phase: Phase): string {
  if (phase === 'planning') return '計画を作っています';
  if (phase === 'awaiting_approval') return '承認待ち';
  if (phase === 'executing') return '実行しています';
  if (phase === 'completed') return '完了';
  if (phase === 'failed') return '止まりました';
  if (phase === 'held') return '保留中';
  if (phase === 'recorded') return '実行中';
  return '待機中';
}

export default function AgentWorkspaceView() {
  const [goal, setGoal] = useState('');
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(true);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  // The task board keeps the most recent plan's binding even after the
  // plan itself is approved or discarded, so delegated work stays
  // visible on the agent screen (the board is the screen's showcase).
  const [boardPlanToken, setBoardPlanToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  // Live view (PR-L2): the run being watched in the 「いまの作業」
  // panel, and the latest run view fed by the drive's progress
  // callback (then by polling once driving hands over at the caps).
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [liveRunView, setLiveRunView] = useState<AgentRunView | null>(null);
  const [artifact, setArtifact] = useState(ARTIFACT_PLACEHOLDER);
  const [checkpoints, setCheckpoints] = useState<CheckpointState[]>([]);
  const [restoring, setRestoring] = useState(true);
  // Attachment intake state (F3, design §1.3): the set id and upload
  // token are capabilities and live in memory only — never persisted,
  // exactly like the plan token. The chips carry names and counts;
  // file bodies are read at selection time, uploaded, and not kept.
  const [attachmentFiles, setAttachmentFiles] = useState<AgentAttachmentChip[]>([]);
  const [attachmentSetId, setAttachmentSetId] = useState<string | null>(null);
  const [attachmentUploadToken, setAttachmentUploadToken] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
          browserApprovalEnabled: data.browserApprovalEnabled === true,
          attachmentsEnabled: data.attachmentsEnabled === true,
          freeOnly: data.freeOnly === true,
          costUsd: typeof data.costUsd === 'number' ? data.costUsd : -1,
          paidFallbackEnabled: data.paidFallbackEnabled === true,
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
      .catch(() => { if (mounted) setLog((current) => [...current, '端末内の実行履歴を読み込めませんでした。']); })
      .finally(() => { if (mounted) setRestoring(false); });
    return () => {
      mounted = false;
      abortRef.current?.abort();
    };
  }, []);

  const persistCheckpoint = useCallback(async (checkpoint: CheckpointState) => {
    setCheckpoints((current) => [...current.filter((item) => item.checkpointId !== checkpoint.checkpointId), checkpoint].sort((a, b) => a.createdAt - b.createdAt));
    try { await saveCheckpointToIndexedDB(checkpoint); }
    catch { setLog((current) => [...current, '結果はこの画面では利用できますが、端末への保存を確認できませんでした。']); }
  }, []);

  // Live view (PR-L2, design §5.1): once this screen's driving stops
  // at the caps ('recorded') while the run continues, keep the panel
  // current by re-reading the run every few seconds. Polling runs
  // only while the panel is on screen, the last known state is
  // non-terminal, and this screen is no longer driving; it stops on
  // unmount, on a new plan, and when the run reaches a terminal state.
  useEffect(() => {
    if (!liveSession || phase !== 'recorded' || !liveRunView) return undefined;
    if (AGENT_RUN_TERMINAL_STATUSES.has(liveRunView.status)) return undefined;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void fetchAgentRunView(liveSession.runId, liveSession.auth, controller.signal)
        .then((view) => { if (view && !controller.signal.aborted) setLiveRunView(view); })
        .catch(() => undefined);
    }, AGENT_RUN_LIVE_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [liveSession, phase, liveRunView]);

  // 「いまの作業」シート／ヘッダー常駐オリンへの要約の共有（PR-β）。
  // 駆動やポーリングの結果（liveRunView）が変わるたびに、平易な
  // ステップタイトルと進み具合だけを共有ストアへ書く。実行系の
  // 挙動には一切影響しない（書き込み専用の副作用）。
  // 計画の全ステップ（タイトル＋状態）も一緒に載せる：「いまの
  // 作業を表示」が開くカードが、現在のステップ1行ではなく実際の
  // 進捗（計画のステップ列と各状態）を見せられるようにするため。
  useEffect(() => {
    if (!liveSession) return;
    const steps = liveSession.steps;
    const total = steps.length;
    const stateAt = (index: number) => liveRunView?.stepsState.find((item) => item.id === `task-${index + 1}`) ?? liveRunView?.stepsState[index];
    const runningIndex = steps.findIndex((_, index) => stateAt(index)?.status === 'running');
    const completedCount = steps.filter((_, index) => stateAt(index)?.status === 'completed').length;
    const runStatus = liveRunView?.status ?? null;
    const terminal = runStatus !== null && AGENT_RUN_TERMINAL_STATUSES.has(runStatus);
    const active = !terminal && (phase === 'executing' || phase === 'recorded' || runningIndex >= 0);
    const currentIndex = runningIndex >= 0 ? runningIndex : Math.min(completedCount, Math.max(0, total - 1));
    const toStepStatus = (status: string | undefined): AgentActivityStepStatus => (status === 'running' || status === 'completed' || status === 'failed' || status === 'blocked' ? status : 'queued');
    reportAgentActivity({
      active,
      outcome: terminal ? (runStatus === 'completed' ? 'completed' : 'failed') : active ? 'running' : null,
      stepTitle: total > 0 ? toolLabel(steps[currentIndex].toolName) : null,
      currentStep: total > 0 ? currentIndex + 1 : 0,
      totalSteps: total,
      steps: steps.map((step, index) => ({ title: toolLabel(step.toolName), status: toStepStatus(stateAt(index)?.status) })),
      updatedAt: Date.now(),
    });
  }, [liveSession, phase, liveRunView]);

  // Attachment intake (F3, design §1.3): read each selected file as
  // text on this device, screen it (file name + body, the same
  // detector chat uses — a hit means the file never leaves the
  // device), check the limits with the numbers attached, then upload
  // it into the set (creating the set on first use). The server
  // repeats every check; its refusals map onto the same plain
  // wording. One file's refusal stops the batch at that file — files
  // already uploaded stay attached and are listed as chips.
  const addAttachmentFiles = useCallback(async (selected: File[]) => {
    if (selected.length === 0 || attachmentBusy || plan) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      let setId = attachmentSetId;
      let token = attachmentUploadToken;
      let chips = attachmentFiles;
      for (const file of selected) {
        if (!isAgentAttachmentTextLike(file)) {
          setAttachmentError(`「${file.name}」はテキスト形式のファイルではないため、添付できません。`);
          break;
        }
        const text = await file.text();
        if (text.length > MAX_AGENT_ATTACHMENT_FILE_CHARS) {
          setAttachmentError(`「${file.name}」は${text.length.toLocaleString()}文字で、上限の${MAX_AGENT_ATTACHMENT_FILE_CHARS.toLocaleString()}文字を${(text.length - MAX_AGENT_ATTACHMENT_FILE_CHARS).toLocaleString()}文字超えています。`);
          break;
        }
        if (chips.length >= MAX_AGENT_ATTACHMENT_FILES) {
          setAttachmentError(`添付できるのは${MAX_AGENT_ATTACHMENT_FILES}件までです。`);
          break;
        }
        const totalChars = chips.reduce((sum, chip) => sum + chip.charCount, 0);
        if (totalChars + text.length > MAX_AGENT_ATTACHMENT_TOTAL_CHARS) {
          setAttachmentError(`添付データの合計が上限の${MAX_AGENT_ATTACHMENT_TOTAL_CHARS.toLocaleString()}文字を超えます（「${file.name}」を加えると${(totalChars + text.length).toLocaleString()}文字になります）。`);
          break;
        }
        if (detectSensitiveInput(`${file.name}\n${text}`).containsSensitiveInput) {
          setAttachmentError(`「${file.name}」には、パスワードや個人情報が含まれる可能性があるため、添付できません。`);
          break;
        }
        if (!setId || !token) {
          const createResponse = await fetch('/api/agent/v3/attachment-sets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({}),
          });
          const created = await createResponse.json() as { attachmentSetId?: string; uploadToken?: string; code?: string };
          if (!createResponse.ok || typeof created.attachmentSetId !== 'string' || typeof created.uploadToken !== 'string') {
            throw new Error(created.code ?? 'AGENT_ATTACHMENT_CREATE_FAILED');
          }
          setId = created.attachmentSetId;
          token = created.uploadToken;
          setAttachmentSetId(setId);
          setAttachmentUploadToken(token);
        }
        const addResponse = await fetch(`/api/agent/v3/attachment-sets/${encodeURIComponent(setId)}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-agent-attachment-token': token },
          cache: 'no-store',
          body: JSON.stringify({ name: file.name, mediaType: file.type || undefined, contentText: text }),
        });
        const added = await addResponse.json() as { ok?: boolean; code?: string };
        if (!addResponse.ok || added.ok !== true) {
          if (added.code === 'AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED') {
            setAttachmentError(`「${file.name}」には、パスワードや個人情報が含まれる可能性があるため、添付できません。`);
          } else if (added.code === 'AGENT_ATTACHMENT_FILE_TOO_LARGE') {
            setAttachmentError(`「${file.name}」は上限の${MAX_AGENT_ATTACHMENT_FILE_CHARS.toLocaleString()}文字を超えているため、添付できません。`);
          } else if (added.code === 'AGENT_ATTACHMENT_KIND_UNSUPPORTED') {
            setAttachmentError(`「${file.name}」はテキスト形式のファイルではないため、添付できません。`);
          } else {
            setAttachmentError(`「${file.name}」を添付できませんでした。`);
          }
          break;
        }
        chips = [...chips, { name: file.name, charCount: text.length }];
        setAttachmentFiles(chips);
      }
    } catch {
      setAttachmentError('添付データを用意できませんでした。少し待ってから、もう一度お試しください。');
    } finally {
      setAttachmentBusy(false);
    }
  }, [attachmentBusy, attachmentFiles, attachmentSetId, attachmentUploadToken, plan]);

  // 「添付を取り消す」(design §2.3): the set is deleted on the server
  // immediately, not just hidden here. Files are removed as a set —
  // there is no per-file removal — and the chips say so. Best-effort:
  // even if the delete request fails, an unclaimed set expires on its
  // own within 24 hours.
  const removeAttachments = useCallback(async () => {
    const setId = attachmentSetId;
    const token = attachmentUploadToken;
    setAttachmentFiles([]);
    setAttachmentSetId(null);
    setAttachmentUploadToken(null);
    setAttachmentError(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    if (setId && token) {
      await fetch(`/api/agent/v3/attachment-sets/${encodeURIComponent(setId)}`, {
        method: 'DELETE',
        headers: { 'x-agent-attachment-token': token },
        cache: 'no-store',
      }).catch(() => undefined);
    }
  }, [attachmentSetId, attachmentUploadToken]);

  const requestPlan = useCallback(async () => {
    const trimmed = goal.trim();
    const planCapable = capability?.ready === true || capability?.browserApprovalEnabled === true;
    if (!trimmed || phase === 'planning' || phase === 'executing' || !planCapable) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlan(null);
    setLiveSession(null);
    setLiveRunView(null);
    setPhase('planning');
    setLog(['実行計画を作っています。']);
    setArtifact('計画を作成しています…');
    // A plan-time refusal the user can act on: an oversize
    // attachment set is refused with AGENT_ATTACHMENT_TOO_LARGE
    // (plan-time, with the reason attached — see the 422 body),
    // and the generic "could not create a plan" line below would
    // hide that reason. Keep the plain-language reason in this
    // variable so the catch block can show it instead.
    let planFailureReason: string | undefined;
    try {
      const response = await fetch('/api/agent/v3/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The upload token is the ownership proof for the set being
          // bound into this plan (design §1.2); without a set, the
          // request is exactly the one this screen has always sent.
          ...(attachmentSetId && attachmentUploadToken ? { 'x-agent-attachment-token': attachmentUploadToken } : {}),
        },
        cache: 'no-store',
        body: JSON.stringify({ goal: trimmed, ...(attachmentSetId ? { attachmentSetId } : {}) }),
        signal: controller.signal,
      });
      const data = await response.json() as Partial<AgentPlan> & { ok?: boolean; code?: string; limitKind?: string; steps?: Array<{ toolName?: unknown; params?: unknown }>; attachments?: unknown };
      if (!response.ok || data.ok !== true || typeof data.runId !== 'string' || typeof data.planToken !== 'string' || !Array.isArray(data.plan) || !isAgentTool(data.selectedTool) || !data.params || typeof data.params !== 'object' || Array.isArray(data.params)) {
        if (data.code === 'AGENT_ATTACHMENT_TOO_LARGE') {
          planFailureReason = data.limitKind === 'chunks'
            ? '添付データの量が上限を超えています。ファイルを減らすか、分割してご依頼ください。'
            : '添付データが多すぎて、一度に処理できる計画に収まりませんでした。ファイルを減らすか、分割してご依頼ください。';
        }
        throw new Error(data.code ?? 'AGENT_PLAN_FAILED');
      }
      const parsedSteps: AgentToolStep[] = Array.isArray(data.steps)
        ? data.steps
          .filter((step): step is { toolName: AgentTool; params: Record<string, unknown> } => Boolean(step) && isAgentTool(step.toolName) && Boolean(step.params) && typeof step.params === 'object' && !Array.isArray(step.params))
          .map((step) => ({ toolName: step.toolName, params: step.params }))
        : [];
      const next: AgentPlan = {
        runId: data.runId,
        planToken: data.planToken,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
        selectedTool: data.selectedTool,
        params: data.params as Record<string, unknown>,
        steps: parsedSteps.length > 0 ? parsedSteps : [{ toolName: data.selectedTool, params: data.params as Record<string, unknown> }],
        goal: trimmed,
        plan: data.plan.filter((step): step is AgentPlanStep => Boolean(step) && typeof step.id === 'string' && typeof step.title === 'string').slice(0, 12),
        attachments: parsePlanAttachments(data.attachments),
      };
      setPlan(next);
      setBoardPlanToken(next.planToken);
      setPhase('awaiting_approval');
      // The plan itself is shown once, in the plan section on the left
      // (steps, work summary, attachment line, approval actions). The
      // right-hand panel is for results only, so while approval is
      // pending it goes back to the empty-results state instead of
      // repeating the plan as a document.
      setArtifact(ARTIFACT_PLACEHOLDER);
      setLog((current) => [...current, '計画を作成しました。まだ作業は始めていません。']);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, planFailureReason ?? '計画を作成できませんでした。依頼内容をご確認のうえ、もう一度お試しください。']);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [attachmentSetId, attachmentUploadToken, capability?.browserApprovalEnabled, capability?.ready, goal, phase]);

  const approveAndExecute = useCallback(async () => {
    if (!plan || phase !== 'awaiting_approval') return;
    // Two approval modes: with an operator credential the admin endpoint is
    // used; without one, the browser approval endpoint authorizes the exact
    // plan from this same-origin session after the explicit approve action.
    const credential = getSessionCredential('admin').trim();
    if (plan.expiresAt && Date.parse(plan.expiresAt) <= Date.now()) {
      setPlan(null);
      setPhase('failed');
      setLog((current) => [...current, '計画の承認期限が切れました。新しい計画を作成してください。']);
      return;
    }

    if (!hasExecutableSteps(plan)) {
      setPhase('failed');
      setLog((current) => [...current, '計画のステップに必要な指定が不足しているため、承認前に停止しました。']);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('executing');
    setLog((current) => [...current, `承認対象: ${plan.steps.map((step) => toolLabel(step.toolName)).join(' → ')}`, credential ? '実行前の安全確認をしています。' : 'このブラウザで承認し、実行前の安全確認をしています。']);
    // Single-step plans keep the legacy {toolName, params} wire shape; the
    // server canonicalizes both shapes to the same signed operation.
    const operationBody = plan.steps.length === 1
      ? { toolName: plan.steps[0].toolName, params: plan.steps[0].params }
      : { steps: plan.steps };
    try {
      const approvalResponse = await fetch(credential ? '/api/agent/v3/approval' : '/api/agent/v3/browser-approval', {
        method: 'POST',
        headers: credential ? authorizationHeaders(credential) : { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          runId: plan.runId,
          planToken: plan.planToken,
          ...operationBody,
          ...(credential ? {} : { confirm: true }),
        }),
        signal: controller.signal,
      });
      const approval = await approvalResponse.json() as { ok?: boolean; approvalToken?: string; code?: string };
      if (!approvalResponse.ok || approval.ok !== true || typeof approval.approvalToken !== 'string') {
        throw new Error(approval.code ?? 'AGENT_APPROVAL_FAILED');
      }

      // Both approval modes (PR-D2 browser, PR-D3 operator; wiring
      // design §4.1/§4.4): the approved plan is recorded as a durable
      // run first and then driven from here, replacing the stateless
      // /execute call. Only the owner binding differs — the plan token
      // in the body for the browser, the Bearer credential for the
      // operator; the creation body and the drive are identical. If
      // the record cannot be created, nothing executes — there is no
      // fallback (design §4.6).
      const runAuth: AgentRunAuth = credential
        ? { kind: 'operator', credential }
        : { kind: 'browser', planToken: plan.planToken };
      const creation = await createAgentRunRecord(
        {
          runId: plan.runId,
          goal: plan.goal,
          planToken: plan.planToken,
          steps: plan.steps,
          // The claim bridge's proof of set ownership (F3): the
          // server re-binds the browser-owned set to this run as it
          // claims it. Operator-created sets already share the run's
          // binding, so for them the token is simply never needed.
          ...(plan.attachments && attachmentUploadToken ? { attachmentUploadToken } : {}),
        },
        approval.approvalToken,
        runAuth,
        controller.signal,
      );
      if (creation === 'store_unavailable') {
        setPhase('failed');
        setArtifact('実行は始めていません。作業の記録が使えないため、止まりました。');
        setLog((current) => [...current, '作業の記録が使えないため、止まりました。実行は始めていません。']);
        return;
      }
      if (plan.attachments) {
        // The set now belongs to the recorded run (claimed at
        // creation); this screen's upload capability has done its
        // job and is dropped, so a later plan starts from a fresh set.
        setAttachmentFiles([]);
        setAttachmentSetId(null);
        setAttachmentUploadToken(null);
        setAttachmentError(null);
        if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      }
      setLog((current) => [...current, '実行を記録しました。進み具合は下の「これまでの作業」にも表示されます。']);
      // Live view (PR-L2): from here the 「いまの作業」 panel follows
      // this run. Driving uses the small per-advance budget so each
      // advance returns after a step or two, and every response's run
      // view is fed into the panel as it arrives (design §5.1).
      setLiveSession({ runId: plan.runId, steps: plan.steps, auth: runAuth });
      setLiveRunView(null);
      const outcome = await driveAgentRun(plan.runId, runAuth, controller.signal, {
        budgetMs: AGENT_RUN_SMALL_ADVANCE_BUDGET_MS,
        onProgress: (view) => { if (view.runId === plan.runId) setLiveRunView(view); },
      });
      if (outcome.kind === 'completed') {
        setArtifact(outcome.artifact ?? '実行が完了しました。');
        if (outcome.artifact) await persistCheckpoint(localRunCheckpoint(plan.runId, outcome.artifact, savedResultTitle(plan.goal)));
        setPhase('completed');
        setLog((current) => [...current, '作業の実行と確認が完了しました。', outcome.artifact ? '結果を端末内に保存しました。' : '']);
        setPlan(null);
        return;
      }
      if (outcome.kind === 'held') {
        setPhase('held');
        setArtifact('実行は保留中です。無料枠が回復したら、下の「これまでの作業」から再開できます。');
        setLog((current) => [...current, '無料枠の上限に達したため、実行を保留にしました。記録は残っているので、下の「これまでの作業」から再開できます。']);
        setPlan(null);
        return;
      }
      if (outcome.kind === 'recorded') {
        setPhase('recorded');
        setArtifact('実行は記録され、続いています。この画面での見守りはここまでです。進み具合は下の「これまでの作業」で確認できます。');
        setLog((current) => [...current, '実行は記録済みで続行しています。進み具合は下の「これまでの作業」で確認できます。']);
        setPlan(null);
        return;
      }
      if (outcome.kind === 'store_unavailable') {
        setPhase('failed');
        setArtifact('作業の記録が使えなくなったため、止まりました。記録の状態は下の「これまでの作業」で確認できます。');
        setLog((current) => [...current, '作業の記録が使えなくなったため、止まりました。']);
        return;
      }
      // outcome.kind === 'failed': the server's reason code stays off
      // screen; the log line is the plain-language mapping (design §4.6).
      console.error('Agent run failed:', outcome.code ?? 'AGENT_RUN_FAILED');
      setPhase('failed');
      setLog((current) => [...current, '実行が完了できませんでした。下の「これまでの作業」も確認してください。']);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, '処理を完了できませんでした。設定や依頼内容をご確認のうえ、もう一度お試しください。']);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [attachmentUploadToken, persistCheckpoint, phase, plan]);

  const resetPlan = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPlan(null);
    setLiveSession(null);
    setLiveRunView(null);
    setPhase('idle');
    setLog((current) => [...current, '計画を最初に戻しました。承認されていない操作は実行していません。']);
  };

  const restoreLocalCheckpoint = (checkpoint: CheckpointState) => {
    setArtifact(checkpoint.artifact);
    setLog((current) => [...current, 'この端末に保存した結果を表示しました（サーバー側の状態は変わりません）。']);
  };

  const ready = (capability?.ready === true || capability?.browserApprovalEnabled === true)
    && capability.freeOnly === true
    && capability.costUsd === 0
    && capability.paidFallbackEnabled === false;
  const plannedParamsReady = plan ? hasExecutableSteps(plan) : false;
  // A research-final run delivers its artifact as a sources JSON
  // string; show it as source cards instead of raw JSON (PR-L2).
  const researchArtifact = useMemo(() => parseAgentResearchArtifact(artifact), [artifact]);

  // 実況パネルのオリンは、実行中ステップがウェブ調査のときは専用の
  // 「調べている」状態にし、成果物を作るステップ（文書・ファイル・
  // 画像の下ごしらえ）のときは「作っている」状態にする（working
  // からの分離、動きの作り直し第1段 PR-β／第2段 2026-11-18）。
  // それ以外は従来のフェーズ連動のまま。
  const livePanelCatState: OriginCatStateKind = (() => {
    if (liveSession && liveRunView) {
      const runningIndex = liveSession.steps.findIndex((_, index) => {
        const state = liveRunView.stepsState.find((item) => item.id === `task-${index + 1}`) ?? liveRunView.stepsState[index];
        return state?.status === 'running';
      });
      if (runningIndex >= 0 && liveSession.steps[runningIndex]?.toolName === 'web_search_grounding') return 'searching';
      if (runningIndex >= 0 && ['document_generator', 'file_writer', 'image_prompt_compiler'].includes(liveSession.steps[runningIndex]?.toolName ?? '')) return 'making';
    }
    return catStateForPhase(phase, checkingCapability, ready);
  })();

  return <section className="flex min-h-full flex-col bg-origin-paper p-3 text-origin-ink md:p-5" aria-label="エージェント">
    <div className="mx-auto grid w-full max-w-[var(--content-wide)] items-start gap-4 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.35fr)]">
      <aside className="origin-workspace rounded-2xl p-4">
        {/* 見出しの三重重なり解消（UI/UX評価 2026-11-25）：ワークスペース
            ヘッダーにも「エージェント」があり、眉見出しまで同じ語を
            重ねると見出しが3段に積み上がる。眉見出しは置かず、
            見出しは「エージェントに任せる」の1本にする。 */}
        <h1 className="text-xl font-bold">エージェントに任せる</h1>
        <p className="mt-1 text-sm leading-6 text-origin-muted">任せたいことを書くと、まず実行計画を作ります。内容を確認して承認すると、計画に沿って作業し、結果を表示します。調べる・まとめる・文書にするような、手順の多い作業に向いています。</p>

        <label htmlFor="agent-goal" className="mt-4 block text-sm font-bold">任せたいこと</label>
        <textarea id="agent-goal" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={4000}
          disabled={phase === 'planning' || Boolean(plan) || phase === 'executing'}
          placeholder="例：このテーマを調べて要点をまとめ、文書案を作ってください"
          className="mt-2 min-h-28 w-full resize-none rounded-xl border border-origin-border bg-origin-surface p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-origin-brand disabled:cursor-not-allowed disabled:opacity-70" />

        {capability?.attachmentsEnabled && <div className="mt-3">
          <span className="block text-sm font-bold">添付データ</span>
          <p className="mt-1 text-[13px] leading-5 text-origin-muted">作業に使うデータを添付できます。テキスト形式のファイルを{MAX_AGENT_ATTACHMENT_FILES}件まで、合計{MAX_AGENT_ATTACHMENT_TOTAL_CHARS.toLocaleString()}文字まで。添付したデータも、計画の承認の対象になります。</p>
          <input ref={attachmentInputRef} type="file" multiple accept=".txt,.csv,.tsv,.md,.json,text/*" className="hidden" aria-label="添付ファイルを選ぶ"
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              event.target.value = '';
              void addAttachmentFiles(selected);
            }} />
          <button type="button" onClick={() => attachmentInputRef.current?.click()}
            disabled={Boolean(plan) || phase === 'planning' || phase === 'executing' || attachmentBusy}
            className="origin-secondary-button mt-2 min-h-11 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
            {attachmentBusy ? '添付しています…' : 'ファイルを選ぶ'}
          </button>
          {attachmentFiles.length > 0 && <>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="添付したファイル">
              {attachmentFiles.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-full border border-origin-border bg-origin-surface py-1 pl-3 pr-1 text-[13px] font-semibold">
                <span>{file.name}（{file.charCount.toLocaleString()}文字）</span>
                <button type="button" onClick={() => void removeAttachments()} aria-label="添付を取り消す"
                  disabled={Boolean(plan) || phase === 'planning' || phase === 'executing'}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-origin-muted disabled:cursor-not-allowed disabled:opacity-50"><X aria-hidden="true" size={14} /></button>
              </li>)}
            </ul>
            <p className="mt-1 text-[13px] leading-5 text-origin-muted">取り消すと、添付したファイルはすべて削除されます。</p>
          </>}
          {attachmentError && <p role="alert" className="mt-2 text-[13px] font-semibold leading-5 text-origin-warning">{attachmentError}</p>}
        </div>}

        <div role="status" className="mt-3 flex items-center justify-between gap-3 text-[13px]">
          <span className="text-origin-muted">{checkingCapability ? '利用できるか確認しています…' : ready ? '利用できます' : 'エージェントは今は使えません'}</span>
          <span className="flex items-center gap-2">
            <OriginCatState state={catStateForPhase(phase, checkingCapability, ready)} />
            <span className={ready ? 'font-bold text-origin-success' : 'font-bold text-origin-warning'}>
              {checkingCapability ? '確認中' : ready ? phaseLabel(phase) : '利用できません'}
            </span>
          </span>
        </div>

        <button type="button" onClick={() => void requestPlan()} disabled={!ready || !goal.trim() || Boolean(plan) || phase === 'planning' || phase === 'executing'}
          {...(ready && !goal.trim() && !plan && phase === 'idle' ? { 'aria-describedby': 'agent-plan-button-hint' } : {})}
          className="origin-primary-button mt-3 min-h-11 w-full rounded-xl px-4 font-bold disabled:cursor-not-allowed">
          {phase === 'planning' ? '計画を作っています…' : '実行計画を作る'}
        </button>
        {/* External evaluation fix (2026-11-25): with the service
            ready but nothing written yet, the status row said
            「利用できます」 while this button stayed unpressable
            with no visible reason. The hint names the one missing
            step, directly under the button it belongs to. */}
        {ready && !goal.trim() && !plan && phase === 'idle' && (
          <p id="agent-plan-button-hint" className="mt-2 text-[13px] leading-5 text-origin-muted">「任せたいこと」を書くと、このボタンを押せます。</p>
        )}

        {plan && <section className="mt-4 rounded-xl border border-origin-border p-3" aria-label="実行計画">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold">実行の流れ</h2>
            <span className="text-[13px] font-bold text-origin-warning">まだ実行していません · 承認待ち</span>
          </div>
          <ol className="mt-2 space-y-2 text-sm">{plan.plan.map((step, index) => <li key={step.id} className="flex gap-2">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-origin-brand-soft text-[13px] font-bold text-origin-brand">{index + 1}</span>
            <span>{step.title}</span>
          </li>)}</ol>

          <p className="mt-4 block text-[13px] font-bold text-origin-muted">行う作業</p>
          <div aria-label="行う作業" className="mt-1 min-h-11 w-full rounded-xl border border-origin-border bg-origin-surface-muted px-3 py-3 text-sm font-semibold">
            {plan.steps.map((step) => toolLabel(step.toolName)).join(' → ')}
          </div>
          {plan.attachments && <p className="mt-2 text-[13px] leading-5 text-origin-muted">添付データ: {plan.attachments.fileCount}件（{plan.attachments.files.map((file) => file.name).join('、')}、合計{plan.attachments.totalChars.toLocaleString()}文字）。このデータも承認の対象です。</p>}
          <p className="mt-1 text-[13px] leading-5 text-origin-muted">承認すると、上に表示された作業だけを行います。内容を変えたいときは、計画をやめて作り直してください。</p>
          {!plannedParamsReady && <p role="alert" className="mt-2 text-[13px] font-semibold leading-5 text-origin-warning">場所や対象など、必要な情報が足りません。依頼文に足して、計画を作り直してください。</p>}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void approveAndExecute()} disabled={phase !== 'awaiting_approval' || !plannedParamsReady}
              className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-bold">
              承認して実行
            </button>
            <button type="button" onClick={resetPlan} className="origin-secondary-button min-h-11 px-3 text-sm font-semibold">計画をやめる</button>
          </div>
        </section>}

        <div className="mt-4 max-h-36 overflow-auto rounded-xl border border-origin-border bg-origin-surface p-3 text-[13px] leading-5 text-origin-muted" aria-label="実行履歴">
          {log.length ? log.filter(Boolean).map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : '進み具合はここに表示されます。'}
        </div>
      </aside>

      <main className="origin-workspace overflow-hidden rounded-2xl">
        {liveSession && <div className="border-b border-origin-border">
          <AgentLivePanel
            steps={liveSession.steps}
            runView={liveRunView}
            statusHint={phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : phase === 'held' ? 'held' : 'active'}
            catState={livePanelCatState}
          />
        </div>}
        <div className="flex items-center justify-between gap-3 border-b border-origin-border px-4 py-3">
          <div><h2 className="font-bold">作業結果</h2></div>
        </div>
        <div className="max-h-[60dvh] overflow-auto p-5">
          {researchArtifact
            ? <AgentResearchSourceCards sources={researchArtifact.sources} />
            : artifact === ARTIFACT_PLACEHOLDER && !liveSession && (phase === 'idle' || phase === 'awaiting_approval')
              ? <div>
                  <p className="text-sm font-bold">まだ結果はありません</p>
                  {/* 進め方の説明は左カラムの導入文に一本化する
                      （UI/UX評価 2026-11-25：同じ説明が左カラム本文・
                      ここの手順リスト・保存結果の説明と3系統に
                      重なっていた）。ここは結果の置き場所だけを示す。 */}
                  <p className="mt-1 text-sm leading-6 text-origin-muted">作業が終わると、結果がここに表示されます。</p>
                </div>
              : <FormattedMarkdown text={artifact} />}
        </div>

        <section className="border-t border-origin-border p-4">
          <h3 className="text-sm font-bold">この端末に保存した結果</h3>
          {restoring ? <p className="mt-2 text-[13px] text-origin-muted">読み込み中…</p> : checkpoints.length === 0
            ? <p className="mt-2 text-[13px] text-origin-muted">終わった作業の結果がここに保存されます。選ぶと、上の欄に表示されます。</p>
            : <>
              <p className="mt-1 text-[13px] text-origin-muted">選ぶと、上の欄に表示されます。</p>
              <ul className="mt-2 space-y-2">{checkpoints.slice().reverse().slice(0, 8).map((item) => {
                const view = savedResultView(item);
                return <li key={item.checkpointId}>
                  <button type="button" onClick={() => restoreLocalCheckpoint(item)}
                    className="origin-secondary-button flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{view.title}</span>
                      {view.meta && <span className="mt-0.5 block truncate text-[13px] text-origin-muted">{view.meta}</span>}
                    </span>
                    <span className="shrink-0 text-[13px] font-bold">{view.status}</span>
                  </button>
                </li>;
              })}</ul>
            </>}
        </section>
      </main>
    </div>

    <div className="mx-auto mt-4 w-full max-w-[var(--content-wide)]">
      <AgentTaskBoard browserPlanToken={boardPlanToken} />
    </div>
  </section>;
}
