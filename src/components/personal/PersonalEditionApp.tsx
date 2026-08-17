import React from 'react';
import App from '../../App';
import type { ConversationMessage } from '../../App';
import type { Settings } from '../../types';

type PersonalEditionAppProps = {
  onSwitchToEnterprise?: () => void;
  settings?: Settings;
  onOpenSettings?: () => void;
  messages?: ConversationMessage[];
  onMessagesChange?: (messages: ConversationMessage[]) => void;
  resetSignal?: number;
};

/**
 * Production entry surface for ORIGIN Personal.
 *
 * Personal 2.0 is rendered here as the single, shared application implementation.
 * Conversation state is intentionally owned by the release root so settings actions
 * can export, import, and reset the exact production conversation safely.
 */
const PersonalEditionApp = React.memo(function PersonalEditionApp({
  onOpenSettings,
  messages,
  onMessagesChange,
  resetSignal,
}: PersonalEditionAppProps) {
  return (
    <App
      onOpenSettings={onOpenSettings}
      messages={messages}
      onMessagesChange={onMessagesChange}
      resetSignal={resetSignal}
    />
  );
});

export default PersonalEditionApp;
