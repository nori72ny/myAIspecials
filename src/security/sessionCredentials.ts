import { useSyncExternalStore } from 'react';

/**
 * セッション内キー保持（外部評価改修 PR-D、設計メモ項目3-a／3-b）。
 *
 * コード実行キーと管理者キーの入力先は設定モーダルに集約され、各画面は
 * このモジュール経由で現在値を読み書きする。保持はメモリ内のみで、
 * localStorage／sessionStorage／IndexedDB へは一切書かない。アプリを
 * 開いている間だけ有効で、リロードすれば消える（現行の「保存されません」
 * という安全設計は変えず、置き場所だけを画面内の入力欄から設定へ移す）。
 */

export type SessionCredentialKind = 'coding' | 'admin';

const values: Record<SessionCredentialKind, string> = {
  coding: '',
  admin: '',
};

const listeners = new Set<() => void>();

export function getSessionCredential(kind: SessionCredentialKind): string {
  return values[kind];
}

export function setSessionCredential(kind: SessionCredentialKind, value: string): void {
  if (values[kind] === value) return;
  values[kind] = value;
  for (const listener of listeners) listener();
}

export function subscribeSessionCredentials(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 現在値を購読する React フック（設定モーダルとコード画面が使う）。 */
export function useSessionCredential(kind: SessionCredentialKind): string {
  return useSyncExternalStore(
    subscribeSessionCredentials,
    () => values[kind],
    () => values[kind],
  );
}
