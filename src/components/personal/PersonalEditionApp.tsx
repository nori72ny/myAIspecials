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
 * The Personal shell is intentionally a thin composition boundary. Conversation,
 * session, artifact and reset state are owned by the release root so IndexedDB
 * hydration and user actions share one source of truth. Keeping a second local
 * state here previously discarded hydrated history and disconnected Settings
 * reset/archive actions from the visible chat.
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
      messages={messages ?? []}
      sessions={sessions ?? []}
      artifacts={artifacts ?? []}
      onArchiveSession={onArchiveSession}
      onRestoreSession={onRestoreSession}
      onMessagesChange={onMessagesChange}
      onArtifactsChange={onArtifactsChange}
      resetSignal={resetSignal ?? 0}
      language={settings?.language ?? 'ja'}
      designTheme={settings?.designTheme ?? 'minimal'}
    />
  );
});

export default PersonalEditionApp;
