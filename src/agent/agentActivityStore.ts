/**
 * エージェントの作業状況の共有ストア（PR-β、2026-11-13）。
 *
 * エージェント画面（AgentWorkspaceView）が現在の run の要約をここへ
 * 書き、チャット画面のヘッダー常駐オリンと「いまの作業」シートが
 * 読む。画面同士を直接結ばず、この小さなモジュールストアを介する
 * ことで、エージェント画面の既存の駆動・ポーリングには触れない。
 *
 * 載せるのは平易な項目タイトルと進み具合だけ（作業工程表示ルール
 * 2026-11-09：詳細・ログ・技術用語は出さない）。要約はエージェント
 * 画面が表示されている間だけ更新されるため、読み手は updatedAt の
 * 新しさを必ず確認し、古い「実行中」は信用しないこと。
 */

/** 計画ステップ1件分の状態（run 記録の stepsState の状態語彙そのまま）。 */
export type AgentActivityStepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

export interface AgentActivityStep {
  /** 平易なステップタイトル（例：ウェブで調べる）。 */
  title: string;
  status: AgentActivityStepStatus;
}

export interface AgentActivitySummary {
  /** 終端状態でなく、実行中とみなせるか。 */
  active: boolean;
  outcome: 'running' | 'completed' | 'failed' | null;
  /** 現在のステップの平易なタイトル（例：ウェブ調査）。 */
  stepTitle: string | null;
  /** 実行中ステップの番号（1始まり）。不明なときは 0。 */
  currentStep: number;
  /** ステップ総数。 */
  totalSteps: number;
  /**
   * 計画の全ステップ（タイトル＋状態）。「いまの作業を表示」が
   * 開くカードが、現在のステップ1行だけでなく計画全体の進捗
   * （どのステップが終わり、どれが実行中か）を見せるために使う。
   * 旧い報告（この項目なし）でも読み手は壊れない。
   */
  steps?: readonly AgentActivityStep[];
  /** 最終更新時刻（Date.now()）。 */
  updatedAt: number;
}

let currentSummary: AgentActivitySummary | null = null;
const listeners = new Set<() => void>();

export function reportAgentActivity(summary: AgentActivitySummary | null): void {
  currentSummary = summary;
  for (const listener of listeners) listener();
}

export function getAgentActivitySnapshot(): AgentActivitySummary | null {
  return currentSummary;
}

export function subscribeAgentActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 「実行中」として信用できる新しさの上限。エージェント画面の
 * ポーリング間隔（5秒）と駆動中の進捗通知に対して十分に長く、
 * 画面を離れて更新が止まった要約をいつまでも実行中と見せない長さ。
 */
export const AGENT_ACTIVITY_FRESH_MS = 30_000;

export function isAgentActivityFresh(summary: AgentActivitySummary | null, now: number): boolean {
  return summary !== null && now - summary.updatedAt <= AGENT_ACTIVITY_FRESH_MS;
}
