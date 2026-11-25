import { useEffect, useState } from 'react';
import { getSessionCredential } from '../security/sessionCredentials';
import {
  groupOrinPanelRuns,
  parseOrinPanelRun,
  type OrinPanelRunGroups,
} from './orinPanelModel';

/**
 * エージェント runs 一覧の取得（オリンパネルと「残っている依頼」
 * ページの共用）。資格情報がある時だけ一覧 API を引き、開いている
 * 間だけ5秒間隔で取り直す。資格情報が無い・引けない場合は
 * unavailable に倒し、呼び出し側が共有ストアの要約などの受け皿を
 * 出す。一度引けた後の一時的な失敗では、最後に確認できた状態を
 * 保つ（パネル設計 §4.4）。
 */
export type OrinPanelRunsState =
  | { kind: 'unavailable' }
  | { kind: 'ready'; groups: OrinPanelRunGroups };

const RUNS_POLL_MS = 5_000;

export function useOrinPanelRuns(active: boolean): OrinPanelRunsState {
  const [runsState, setRunsState] = useState<OrinPanelRunsState>({ kind: 'unavailable' });

  useEffect(() => {
    if (!active) return;
    const credential = getSessionCredential('admin').trim();
    if (!credential) {
      setRunsState({ kind: 'unavailable' });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/agent/v3/runs?limit=50', {
          headers: { Authorization: `Bearer ${credential}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await response.json() as { ok?: unknown; runs?: unknown };
        if (cancelled || controller.signal.aborted) return;
        if (!response.ok || data.ok !== true || !Array.isArray(data.runs)) {
          setRunsState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
          return;
        }
        const runs = data.runs.map(parseOrinPanelRun).filter((run) => run !== null);
        setRunsState({ kind: 'ready', groups: groupOrinPanelRuns(runs, Date.now()) });
      } catch {
        if (cancelled || controller.signal.aborted) return;
        setRunsState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, RUNS_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active]);

  return runsState;
}
