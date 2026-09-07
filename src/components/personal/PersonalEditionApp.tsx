import React, { useCallback, useState } from 'react';
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

const PersonalEditionApp = React.memo(function PersonalEditionApp({
  settings,
  onOpenSettings,
  messages: parentMessages,
  sessions: parentSessions,
  artifacts: parentArtifacts,
  onArchiveSession: parentOnArchiveSession,
  onRestoreSession: parentOnRestoreSession,
  onMessagesChange: parentOnMessagesChange,
  onArtifactsChange: parentOnArtifactsChange,
  resetSignal = 0,
}: PersonalEditionAppProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => parentMessages ?? []);
  const [artifacts, setArtifacts] = useState<ArtifactBlock[]>(() => [...(parentArtifacts ?? [])]);
  const effectiveSessions = parentSessions ?? [];

  const handleMessagesChange = useCallback(
    (nextMessages: ConversationMessage[]) => {
      setMessages(nextMessages);
      parentOnMessagesChange?.(nextMessages);
    },
    [parentOnMessagesChange],
  );

  const handleArtifactsChange = useCallback(
    (nextArtifacts: ArtifactBlock[]) => {
      setArtifacts(nextArtifacts);
      parentOnArtifactsChange?.(nextArtifacts);
    },
    [parentOnArtifactsChange],
  );

  const handleArchiveSession = useCallback(
    (nextMessages: readonly ConversationMessage[]) => {
      parentOnArchiveSession?.(nextMessages);
    },
    [parentOnArchiveSession],
  );

  const handleRestoreSession = useCallback(
    (session: ConversationSession) => {
      const restored = session.messages.map((message) => ({ ...message }));
      setMessages(restored);
      parentOnRestoreSession?.(session);
      parentOnMessagesChange?.(restored);
    },
    [parentOnMessagesChange, parentOnRestoreSession],
  );

  return (
    <App
      onOpenSettings={onOpenSettings}
      messages={messages}
      sessions={effectiveSessions}
      artifacts={artifacts}
      onArchiveSession={handleArchiveSession}
      onRestoreSession={handleRestoreSession}
      onMessagesChange={handleMessagesChange}
      onArtifactsChange={handleArtifactsChange}
      resetSignal={resetSignal}
      language={settings?.language ?? 'ja'}
      designTheme={settings?.designTheme ?? 'minimal'}
    />
  );
});

export default PersonalEditionApp;
