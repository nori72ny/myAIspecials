/**
 * オリンパネルの「作業状況」モデル（第1段、設計
 * ORIN_PANEL_DESIGN_2026-11-24 §4・§5）。
 *
 * エージェントの run 一覧（GET /api/agent/v3/runs の公開形）を、
 * 表示の4分類（作業中／未対応／止まっています／完了）へ寄せ、
 * 進捗%を「実測できる分母があるものだけ」に付ける純粋関数の集まり。
 * 取得や描画は OrinPanel 側が担い、ここは変換だけを行う
 * （単体テストで分類・%・保持窓を固定するため）。
 *
 * %の規則（§5）：
 * - 分母＝計画ステップ総数、分子＝完了ステップ数。切り捨て。
 * - 計画が決まっていない（planning で計画なし）間は出さない。
 * - 承認待ちは出さない（0%は「始まって何も終わっていない」と
 *   読めるため、未着手と区別する）。実行待ち（queued）も、
 *   実際に進んだステップが1つも無い間は出さない。
 * - 止まっている run は停止時点の%を出してよい。
 * - 完了は 100%（n/m 併記）。
 * %には必ず「nステップ中 mつ完了」の併記を付ける。
 */

/** パネルが扱う run の公開形（タスクボードの parseRunView と同型）。 */
export interface OrinPanelRun {
  runId: string;
  status: string;
  goal: string;
  plan: Array<{ toolName: string }> | null;
  stepsState: Array<{ id: string; status: string }>;
  hold: { reason: string; resumeConditionKind: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type OrinPanelWorkGroup = 'active' | 'pending' | 'stopped' | 'done';

export interface OrinPanelProgress {
  percent: number;
  done: number;
  total: number;
}

export interface OrinPanelStep {
  /** 計画ステップの道具名。平易なタイトルは描画時に言語で引く。 */
  toolName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
}

export interface OrinPanelAgentItem {
  runId: string;
  title: string;
  group: OrinPanelWorkGroup;
  /** 分類の表示文（例：作業中、計画の確認待ちです）。 */
  statusText: { ja: string; en: string };
  /** held の理由に応じた平易な1行。held 以外では null。 */
  note: { ja: string; en: string } | null;
  progress: OrinPanelProgress | null;
  steps: OrinPanelStep[];
  /** 始めた時刻の目安（「14時ごろ」）。時刻が読めない場合は null。 */
  startedHint: { ja: string; en: string } | null;
  /** 並び替え用（新しい順）。 */
  sortAt: number;
}

const KNOWN_RUN_STATUSES = new Set([
  'planning', 'awaiting_approval', 'queued', 'running', 'held',
  'completed', 'failed', 'cancelled', 'expired',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 一覧 API の生の run を、パネルが扱える形へ寄せる。形が合わないものは null。 */
export function parseOrinPanelRun(raw: unknown): OrinPanelRun | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.runId !== 'string' || !raw.runId.startsWith('run-')) return null;
  if (typeof raw.status !== 'string' || !KNOWN_RUN_STATUSES.has(raw.status)) return null;
  if (typeof raw.goal !== 'string') return null;
  const plan = Array.isArray(raw.plan)
    ? raw.plan.flatMap((step) => (isRecord(step) && typeof step.toolName === 'string' ? [{ toolName: step.toolName }] : []))
    : null;
  const stepsState: OrinPanelRun['stepsState'] = Array.isArray(raw.stepsState)
    ? raw.stepsState.flatMap((step) => (isRecord(step) && typeof step.id === 'string' && typeof step.status === 'string'
      ? [{ id: step.id, status: step.status }]
      : []))
    : [];
  let hold: OrinPanelRun['hold'] = null;
  if (isRecord(raw.hold) && typeof raw.hold.reason === 'string') {
    const condition = isRecord(raw.hold.resumeCondition) ? raw.hold.resumeCondition : null;
    hold = {
      reason: raw.hold.reason,
      resumeConditionKind: condition && typeof condition.kind === 'string' ? condition.kind : 'condition',
    };
  }
  return {
    runId: raw.runId,
    status: raw.status,
    goal: raw.goal,
    plan,
    stepsState,
    hold,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

/** 計画ステップの平易なタイトル（タスクボードの TOOL_LABELS と同じ語彙）。 */
const PANEL_STEP_TOOL_LABELS: Record<string, { ja: string; en: string }> = {
  document_generator: { ja: '文書を作る', en: 'Write the document' },
  code_interpreter: { ja: 'コードを作って確認する', en: 'Write and check code' },
  image_prompt_compiler: { ja: '画像を作るための指示文を作る', en: 'Prepare the image brief' },
  web_search_grounding: { ja: 'ウェブで調べる', en: 'Search the web' },
  repository_explorer: { ja: 'ファイルの一覧を見る', en: 'Look at the files' },
  file_reader: { ja: 'ファイルを読む', en: 'Read a file' },
  file_writer: { ja: 'ファイルを作る・直す', en: 'Create or update a file' },
  verification_runner: { ja: 'テストと動作確認', en: 'Run tests and checks' },
};

export function orinPanelStepTitle(toolName: string, ja: boolean): string {
  const label = PANEL_STEP_TOOL_LABELS[toolName];
  if (label) return ja ? label.ja : label.en;
  return ja ? '作業' : 'Work';
}

/** ステップ状態の平易な表示文（実況パネル・旧カードの語彙と揃える）。 */
export function orinPanelStepStatusText(status: OrinPanelStep['status'], ja: boolean): string {
  if (status === 'running') return ja ? '実行中' : 'In progress';
  if (status === 'completed') return ja ? '完了' : 'Done';
  if (status === 'failed' || status === 'blocked') return ja ? '止まりました' : 'Stopped';
  return ja ? 'まだ' : 'Pending';
}

/** 依頼内容の要約（タスクボードの作法：空白を整え先頭を切り詰める）。 */
export function orinPanelGoalSummary(goal: string): string {
  const collapsed = goal.replace(/\s+/g, ' ').trim();
  return collapsed.length > 90 ? `${collapsed.slice(0, 90)}…` : collapsed;
}

/** run の内部状態を表示の4分類へ寄せる（設計 §4.2）。 */
export function classifyOrinPanelRun(status: string): OrinPanelWorkGroup {
  if (status === 'planning' || status === 'queued' || status === 'running') return 'active';
  if (status === 'awaiting_approval') return 'pending';
  if (status === 'completed') return 'done';
  return 'stopped'; // held / failed / cancelled / expired
}

/**
 * 進捗%の算出（設計 §5.2）。出せない場合は null。
 * - 承認待ちは常に出さない。
 * - 計画ステップが無い（未確定）場合は出さない。
 * - 作業中・実行待ちで、完了したステップも実行中のステップも
 *   無い（＝まだ何も始まっていない）場合は出さない。
 */
export function orinPanelRunProgress(run: OrinPanelRun): OrinPanelProgress | null {
  if (run.status === 'awaiting_approval') return null;
  const total = run.plan?.length ?? 0;
  if (total === 0) return null;
  const done = run.stepsState.filter((step) => step.status === 'completed').length;
  const group = classifyOrinPanelRun(run.status);
  if (group === 'active') {
    const started = done > 0 || run.stepsState.some((step) => step.status === 'running' || step.status === 'failed' || step.status === 'blocked');
    if (!started) return null;
  }
  return { percent: Math.floor((done / total) * 100), done, total };
}

/** held の平易な1行（設計 §4.2）。手動の保留だけは自動再開を謳わない。 */
export function orinPanelHoldNote(run: OrinPanelRun): { ja: string; en: string } | null {
  if (run.status !== 'held') return null;
  const kind = run.hold?.resumeConditionKind ?? 'condition';
  if (kind === 'manual') {
    return { ja: '一時停止中です', en: 'Paused' };
  }
  if (run.hold?.reason === 'quota_exhausted' || kind === 'quota_reset') {
    return {
      ja: '混み合っているため一時停止中です。自動で再開します',
      en: 'Paused while things are busy. It will resume on its own.',
    };
  }
  return {
    ja: '一時停止中です。条件が整えば自動で再開します',
    en: 'Paused. It will resume on its own once it can.',
  };
}

function runStatusText(run: OrinPanelRun, group: OrinPanelWorkGroup): { ja: string; en: string } {
  if (group === 'active') return { ja: '作業中', en: 'Working' };
  if (group === 'pending') return { ja: '計画の確認待ちです', en: 'Waiting for your plan approval' };
  if (group === 'done') return { ja: '完了', en: 'Done' };
  if (run.status === 'held') return { ja: '止まっています', en: 'Stopped for now' };
  return { ja: '最後まで進めませんでした', en: 'Could not finish' };
}

function startedHint(createdAt: string): { ja: string; en: string } | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const hour = date.getHours();
  return { ja: `${hour}時ごろ開始`, en: `Started around ${hour}:00` };
}

function normalizeStepStatus(status: string): OrinPanelStep['status'] {
  if (status === 'running' || status === 'completed' || status === 'failed' || status === 'blocked') return status;
  return 'queued';
}

/** run 1件をパネルの項目へ変換する。 */
export function toOrinPanelAgentItem(run: OrinPanelRun): OrinPanelAgentItem {
  const group = classifyOrinPanelRun(run.status);
  const steps: OrinPanelStep[] = (run.plan ?? []).map((step, index) => ({
    toolName: step.toolName,
    status: normalizeStepStatus(run.stepsState[index]?.status ?? 'queued'),
  }));
  const updated = new Date(run.updatedAt).getTime();
  const created = new Date(run.createdAt).getTime();
  return {
    runId: run.runId,
    title: orinPanelGoalSummary(run.goal),
    group,
    statusText: runStatusText(run, group),
    note: orinPanelHoldNote(run),
    progress: orinPanelRunProgress(run),
    steps,
    startedHint: startedHint(run.createdAt),
    sortAt: Number.isFinite(updated) ? updated : (Number.isFinite(created) ? created : 0),
  };
}

/** 完了の保持窓（設計 §4.4・統括裁定：直近24時間・最大10件）。 */
export const ORIN_PANEL_DONE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ORIN_PANEL_DONE_MAX = 10;

export interface OrinPanelRunGroups {
  active: OrinPanelAgentItem[];
  pending: OrinPanelAgentItem[];
  stopped: OrinPanelAgentItem[];
  done: OrinPanelAgentItem[];
}

/**
 * run 一覧を4分類の節へ分ける。各節は新しい順。
 * 完了だけは保持窓（24時間）と件数上限（10件）で切り取る。
 * 作業中・未対応・止まっていますは古さで落とさない。
 */
export function groupOrinPanelRuns(runs: readonly OrinPanelRun[], now: number): OrinPanelRunGroups {
  const groups: OrinPanelRunGroups = { active: [], pending: [], stopped: [], done: [] };
  for (const run of runs) {
    const item = toOrinPanelAgentItem(run);
    if (item.group === 'done') {
      if (now - item.sortAt > ORIN_PANEL_DONE_WINDOW_MS) continue;
      groups.done.push(item);
    } else {
      groups[item.group].push(item);
    }
  }
  const byNewest = (a: OrinPanelAgentItem, b: OrinPanelAgentItem) => b.sortAt - a.sortAt;
  groups.active.sort(byNewest);
  groups.pending.sort(byNewest);
  groups.stopped.sort(byNewest);
  groups.done.sort(byNewest);
  groups.done = groups.done.slice(0, ORIN_PANEL_DONE_MAX);
  return groups;
}

/** %の併記文（「43%（7ステップ中 3つ完了）」）。 */
export function orinPanelProgressText(progress: OrinPanelProgress, ja: boolean): string {
  return ja
    ? `${progress.percent}%（${progress.total}ステップ中 ${progress.done}つ完了）`
    : `${progress.percent}% (${progress.done} of ${progress.total} steps done)`;
}
