import React, { useState } from 'react';
import { PersonalTopView } from './components/personal/PersonalTopView';
import { ArtifactWorkspace } from './components/personal/ArtifactWorkspace';
import { ChatInputArea } from './components/personal/ChatInputArea';
import { StreamArtifactParser, ArtifactBlock } from './lib/orchestration/StreamArtifactParser';
import { OriginSuperEngine } from './lib/orchestration/OriginSuperEngine';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactBlock | null>(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemma-4-26b-a4b-it:free',
          systemPrompt: OriginSuperEngine.buildSystemPrompt(),
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) throw new Error('通信エラーが発生しました');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantFullText = '';

      const assistantMsgId = `asst-${Date.now()}`;
      setMessages((prev) => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantFullText += decoder.decode(value, { stream: true });

        const parsed = StreamArtifactParser.parse(assistantFullText);

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, content: parsed.conversationalText } : m))
        );

        if (parsed.activeArtifact) {
          setActiveArtifact(parsed.activeArtifact);
          setIsWorkspaceOpen(true);
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', content: 'エラーが発生しました。再度お試しください。' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans antialiased">
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-14 px-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent-brand)] shadow-[0_0_8px_var(--accent-brand)]" />
            <span className="font-extrabold text-sm tracking-tight">ORIGIN Personal</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--border-subtle)] text-[var(--text-secondary)]">2.0</span>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setActiveArtifact(null); setIsWorkspaceOpen(false); }}
              className="text-xs px-2.5 py-1.5 rounded-lg hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors min-h-[36px]"
            >
              新規対話
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col">
          {messages.length === 0 ? (
            <PersonalTopView onQuickPrompt={handleSendMessage} />
          ) : (
            <div className="max-w-3xl w-full mx-auto space-y-4 pb-8 flex-1">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} spring-in`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-[var(--leading-relaxed)] select-text ${
                      m.role === 'user'
                        ? 'bg-[var(--accent-brand)] text-white shadow-md'
                        : 'bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] shadow-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap word-break-all">{m.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <ChatInputArea
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          onStopGeneration={() => setIsLoading(false)}
        />
      </main>

      <ArtifactWorkspace
        artifact={activeArtifact}
        isOpen={isWorkspaceOpen}
        onClose={() => setIsWorkspaceOpen(false)}
      />
    </div>
  );
};
