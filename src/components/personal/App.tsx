import React from 'react';

export interface AppProps {
  onOpenSettings?: () => void;
  onNewConversation?: () => void;
  onMessagesChange?: (messages: unknown[]) => void;
  [key: string]: unknown;
}

export default function App(props: AppProps) {
  const { onOpenSettings, onNewConversation, ...rest } = props;

  return (
    <div {...rest}>
      <header>
        <button type="button" aria-label="設定を開く" onClick={(e) => { e.stopPropagation(); onOpenSettings?.(); }}>
          ⚙️
        </button>
        <button type="button" aria-label="新規対話" onClick={(e) => { e.stopPropagation(); onNewConversation?.(); }}>
          ＋
        </button>
      </header>
    </div>
  );
}
