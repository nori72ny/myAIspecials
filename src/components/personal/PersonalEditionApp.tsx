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

/**
 * Production entry surface for ORIGIN Personal.
 *
 * The Personal shell intentionally starts with a clean conversation. The shell
 * owns the live message state so App can still render user/AI/error messages
 * immediately after send, while parent-provided historical state is not
 * re-injected during the initial mount.
 */
const PersonalEditionApp = React.memo(function PersonalEditionApp({
  settings,
  onOpenSettings,
  artifacts: parentArtifacts,
  onArtifactsChange: parentOnArtifactsChange,
}: PersonalEditionAppProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactBlock[]>([]);

  const handleMessagesChange = useCallback((nextMessages: ConversationMessage[]) => {
    setMessages(nextMessages);
  }, []);

  const handleArtifactsChange = useCallback((nextArtifacts: ArtifactBlock[]) => {
    setArtifacts(nextArtifacts);
    parentOnArtifactsChange?.(nextArtifacts);
  }, [parentOnArtifactsChange]);

  const handleArchiveSession = useCallback(() => {
    // Deliberately do not restore archived sessions into the initial shell.
  }, []);

  const handleRestoreSession = useCallback(() => {
    // Historical sessions are not auto-restored from the Personal shell.
  }, []);

  return (
    <App
      onOpenSettings={onOpenSettings}
      messages={messages}
      sessions={[]}
      artifacts={artifacts.length ? artifacts : parentArtifacts ?? []}
      onArchiveSession={handleArchiveSession}
      onRestoreSession={handleRestoreSession}
      onMessagesChange={handleMessagesChange}
      onArtifactsChange={handleArtifactsChange}
      resetSignal={0}
      language={settings?.language ?? 'ja'}
      designTheme={settings?.designTheme ?? 'minimal'}
    />
  );
});

export default PersonalEditionApp;
