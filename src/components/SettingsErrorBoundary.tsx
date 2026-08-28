import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean };

/** Settings must never take down the surrounding chat tree. */
export default class SettingsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Fail closed: do not expose internal exception details.
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="dialog" aria-modal="true" aria-labelledby="settings-fallback-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
        <div className="origin-surface w-full max-w-md rounded-2xl border p-5 shadow-xl">
          <h2 id="settings-fallback-title" className="text-base font-bold">設定を安全モードで表示しています</h2>
          <p className="origin-muted mt-2 text-sm leading-6">一時的に設定の一部を読み込めませんでした。既定値を使用しています。ページを再読み込みしても改善しない場合は、ブラウザーのサイトデータを確認してください。</p>
          <button type="button" className="origin-primary-button mt-4 min-h-11 w-full rounded-xl px-4 text-sm font-semibold" onClick={() => window.location.reload()}>再読み込み</button>
        </div>
      </div>
    );
  }
}
