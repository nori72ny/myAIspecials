import { useEffect, useState } from 'react';
import { getSessionCredential } from '../security/sessionCredentials';
import {
  groupOrinPanelRuns,
  parseOrinPanelRun,
  type OrinPanelRunGroups,
} from './orinPanelModel';

/**
 * エージェント runs 一覧の取得（オリンパネルと「残っている依頼」
 * ページの共用ストア）。
 *
 * 以前はコンポーネントごとに独立して取得していたため、開いた
 * 順序・タイミングや、管理者キーを入れた前後で、パネルとページが
 * 同じ時刻に違う件数を見せることがあった（2026-11-25 の本番
 * チェックで実測：ページは「残っている依頼はありません」、
 * パネルには複数件）。材料の源泉はサーバーの run 一覧ただ1つに
 * 統一し、購読している画面が1つでもある間は1本の取得を共有する。
 * 資格情報は取得のたびに読み直すため、設定で管理者キーを入れた
 * 後も、画面を開き直さずに次の取得から反映される。
 *
 * 状態の意味（0件と「分からない」を混同しない）：
 * - unavailable：資格情報が無い、または最初の取得が失敗した。
 *   「1件も無い」という意味ではない。
 * - loading：資格情報があり、最初の取得が終わっていない。
 * - ready：groups が最新の確認結果。一度引けた後の一時的な
 *   失敗では、最後に確認できた状態を保つ（パネル設計 §4.4）。
 *
 * 購読が全て外れたら取り直しを止め、状態は初期化する
 * （次に開いた時に引き直す）。
 */
export type OrinPanelRunsState =
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'ready'; groups: OrinPanelRunGroups };

const RUNS_POLL_MS = 5_000;

let state: OrinPanelRunsState = { kind: 'unavailable' };
const listeners = new Set<(next: OrinPanelRunsState) => void>();
let pollTimer: number | null = null;
let fetchInFlight = false;
/** 購読の世代。世代が変わった後に届いた取得結果は捨てる。 */
let generation = 0;

function emit(next: OrinPanelRunsState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

async function tick(gen: number): Promise<void> {
  const credential = getSessionCredential('admin').trim();
  if (!credential) {
    if (state.kind !== 'unavailable') emit({ kind: 'unavailable' });
    return;
  }
  if (state.kind === 'unavailable') emit({ kind: 'loading' });
  if (fetchInFlight) return;
  fetchInFlight = true;
  try {
    const response = await fetch('/api/agent/v3/runs?limit=50', {
      headers: { Authorization: `Bearer ${credential}` },
      cache: 'no-store',
    });
    const data = await response.json() as { ok?: unknown; runs?: unknown };
    if (gen !== generation) return;
    if (!response.ok || data.ok !== true || !Array.isArray(data.runs)) {
      // 一度も引けていない時だけ「分からない」に倒す。引けた後の
      // 一時的な失敗では最後に確認できた状態を保つ（§4.4）。
      if (state.kind === 'loading') emit({ kind: 'unavailable' });
      return;
    }
    const runs = data.runs.map(parseOrinPanelRun).filter((run) => run !== null);
    emit({ kind: 'ready', groups: groupOrinPanelRuns(runs, Date.now()) });
  } catch {
    if (gen !== generation) return;
    if (state.kind === 'loading') emit({ kind: 'unavailable' });
  } finally {
    fetchInFlight = false;
  }
}

function subscribeOrinPanelRuns(listener: (next: OrinPanelRunsState) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    generation += 1;
    const gen = generation;
    void tick(gen);
    pollTimer = window.setInterval(() => { void tick(gen); }, RUNS_POLL_MS);
  } else {
    listener(state);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation += 1;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      state = { kind: 'unavailable' };
    }
  };
}

/**
 * 購読中（active）だけ共有ストアから runs の状態を受け取る。
 * パネルは開いている間、ページは表示されている間だけ active にする。
 */
export function useOrinPanelRuns(active: boolean): OrinPanelRunsState {
  const [snapshot, setSnapshot] = useState<OrinPanelRunsState>({ kind: 'unavailable' });

  useEffect(() => {
    if (!active) {
      setSnapshot({ kind: 'unavailable' });
      return;
    }
    return subscribeOrinPanelRuns(setSnapshot);
  }, [active]);

  return snapshot;
}
