import React from 'react';
import App from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { Settings } from '../../types';

type PersonalEditionAppProps = {
  onSwitchToEnterprise?: () => void;
  settings?: Settings;
  onOpenSettings?: () => void;
  messages?: ConversationMessage[];
  sessions?: readonly ConversationSession[];
  artifacts?: readonly ArtifactBlock[];
  onArchiveSession?: (messages: readonly ConversationMessage[]) => void;
  onRestoreSession?: (session: ConversationSession) => void;
  onMessagesChange?: (messages: ConversationMessage[]) => void;
  onArtifactsChange?: (artifacts: ArtifactBlock[]) => void;
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
  settings,
  onOpenSettings,
  messages,
  sessions,
  artifacts,
  onArchiveSession,
  onRestoreSession,
  onMessagesChange,
  onArtifactsChange,
  resetSignal,
}: PersonalEditionAppProps) {
  return (
    <App
      onOpenSettings={onOpenSettings}
      messages={messages}
      sessions={sessions}
      artifacts={artifacts}
      onArchiveSession={onArchiveSession}
      onRestoreSession={onRestoreSession}
      onMessagesChange={onMessagesChange}
      onArtifactsChange={onArtifactsChange}
      resetSignal={resetSignal}
      language={settings?.language ?? 'ja'}
    />
  );
});

export default PersonalEditionApp;
