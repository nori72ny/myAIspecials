import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface ArtifactBlock {
  id: string;
  type: 'code' | 'markdown' | 'mermaid' | 'html';
  title: string;
  language: string;
  content: string;
  isComplete: boolean;
}

export interface ParsedStreamFrame {
  conversationalText: string;
  artifacts: ArtifactBlock[];
  activeArtifact: ArtifactBlock | null;
}

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export class StreamArtifactParser {
  public static parse(fullText: string): ParsedStreamFrame {
    if (!fullText) return { conversationalText: '', artifacts: [], activeArtifact: null };

    const normalized = fullText.replace(/\r\n/g, '\n');
    const artifacts: ArtifactBlock[] = [];
    let conversationalText = '';
    let cursor = 0;
    let artifactIndex = 0;

    while (cursor < normalized.length) {
      const fenceMatch = /(?:^|\n)```([a-zA-Z0-9_-]+)?(?::([^\n]+))?[ \t]*(?:\n|$)/g;
      fenceMatch.lastIndex = cursor;
      const match = fenceMatch.exec(normalized);

      if (!match) {
        const trailingFenceCheck = /(?:^|\n)(`{1,3}[a-zA-Z0-9_-]*(?::[^\n]*)?[ \t]*)$/.exec(normalized.slice(cursor));
        conversationalText += trailingFenceCheck
          ? normalized.slice(cursor, normalized.length - trailingFenceCheck[1].length)
          : normalized.slice(cursor);
        break;
      }

      const matchIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
      conversationalText += normalized.slice(cursor, matchIndex);
      const rawLang = (match[1] || 'text').trim().toLowerCase();
      const rawTitle = (match[2] || '').trim();
      const title = rawTitle.slice(0, 100).replace(/[\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '').trim() || `Artifact-${artifactIndex + 1}`;
      const contentStart = matchIndex + match[0].length - (match[0].startsWith('\n') ? 1 : 0);
      const closeFenceRegex = /(?:^|\n)```[ \t]*(?:\n|$)/g;
      closeFenceRegex.lastIndex = contentStart;
      const closeMatch = closeFenceRegex.exec(normalized);
      const type = rawLang === 'html' || rawLang === 'svg' ? 'html' : rawLang === 'mermaid' ? 'mermaid' : rawLang === 'markdown' || rawLang === 'md' ? 'markdown' : 'code';
      const id = `art-${artifactIndex++}`;

      if (!closeMatch) {
        artifacts.push({ id, type, title, language: rawLang, content: normalized.slice(contentStart), isComplete: false });
        break;
      }

      const contentEnd = closeMatch.index + (closeMatch[0].startsWith('\n') ? 1 : 0);
      artifacts.push({ id, type, title, language: rawLang, content: normalized.slice(contentStart, contentEnd), isComplete: true });
      cursor = closeMatch.index + closeMatch[0].length;
    }

    return { conversationalText: conversationalText.trim(), artifacts, activeArtifact: artifacts.at(-1) ?? null };
  }
}

const copyText = async (value: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Continue to the document-command fallback for restrictive browsers.
  }

  const helper = document.createElement('textarea');
  helper.value = value;
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  if (!copied) throw new Error('copy unavailable');
};

export const ArtifactWorkspace: React.FC<{ artifact: ArtifactBlock | null; isOpen: boolean; onClose: () => void }> = ({ artifact, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('code');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  useEffect(() => {
    setActiveTab('code');
    setCopied(false);
  }, [artifact?.id]);

  const sandboxSrcDoc = useMemo(() => {
    if (!artifact || (artifact.type !== 'html' && artifact.language !== 'html' && artifact.language !== 'svg')) return '';
    const sanitized = artifact.content.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none';"><meta name="referrer" content="no-referrer"><script>window.addEventListener('click',function(e){var t=e.target;while(t&&t.tagName!=='A')t=t.parentElement;if(t&&t.tagName==='A'){e.preventDefault();e.stopPropagation();}},true);window.open=function(){return null;};</script><style>html,body{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;padding:16px;color:CanvasText;background:transparent}</style></head><body>${sanitized}</body></html>`;
  }, [artifact]);

  if (!isOpen || !artifact) return null;
  const isRenderable = artifact.type === 'html' || artifact.language === 'html' || artifact.language === 'svg';
  const downloadArtifact = () => {
    const extension = artifact.language === 'markdown' || artifact.language === 'md' ? 'md' : artifact.language === 'html' ? 'html' : artifact.language === 'svg' ? 'svg' : artifact.language || 'txt';
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(new Blob([artifact.content], { type: 'text/plain;charset=utf-8' }));
    anchor.href = url;
    anchor.download = `${artifact.title.replace(/[^a-z0-9_-]/gi, '_') || 'origin-artifact'}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = async () => {
    if (!workspaceRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen?.();
    else await workspaceRef.current.requestFullscreen?.();
  };

  return (
    <aside ref={workspaceRef} aria-label="成果物プレビューワークスペース" data-testid="artifact-workspace" className="origin-workspace fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l shadow-2xl sm:w-[560px]">
      <div className="flex min-h-16 items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 sm:px-4">
        <div className="min-w-0 flex flex-1 items-center gap-2">
          <span className="origin-badge rounded-md border px-2 py-1 text-xs font-mono font-semibold">{artifact.language}</span>
          <h2 className="truncate text-sm font-semibold">{artifact.title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {isRenderable && (
            <div role="group" aria-label="表示モード" className="origin-surface-muted flex rounded-xl border p-1">
              <button type="button" aria-label="コードを表示" aria-pressed={activeTab === 'code'} onClick={() => setActiveTab('code')} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${activeTab === 'code' ? 'origin-primary-button' : 'origin-secondary-button'}`}>Code</button>
              <button type="button" aria-label="プレビューを表示" aria-pressed={activeTab === 'preview'} onClick={() => setActiveTab('preview')} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${activeTab === 'preview' ? 'origin-primary-button' : 'origin-secondary-button'}`}>Preview</button>
            </div>
          )}
          <button type="button" aria-label="成果物をコピー" onClick={() => void copyText(artifact.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2_000); })} className="origin-secondary-button rounded-xl border px-3 text-xs font-semibold">{copied ? 'コピー済み' : 'Copy'}</button>
          <button type="button" aria-label="成果物をダウンロード" onClick={downloadArtifact} className="origin-secondary-button rounded-xl border px-3 text-xs font-semibold">Download</button>
          <button type="button" aria-label={isFullscreen ? '全画面表示を終了' : '全画面で表示'} aria-pressed={isFullscreen} onClick={() => void toggleFullscreen()} className="origin-secondary-button hidden rounded-xl border px-3 text-xs font-semibold sm:inline-flex">{isFullscreen ? '縮小' : '全画面'}</button>
          <button type="button" aria-label="成果物ワークスペースを閉じる" onClick={onClose} className="origin-secondary-button inline-flex h-11 w-11 items-center justify-center rounded-xl border text-lg">✕</button>
        </div>
      </div>
      <div className="origin-code-panel min-h-0 flex-1 overflow-auto p-4">
        {activeTab === 'preview' && isRenderable ? <iframe title="Preview" srcDoc={sandboxSrcDoc} sandbox="allow-scripts" referrerPolicy="no-referrer" className="origin-surface h-full w-full rounded-xl border" /> : <pre className="m-0 whitespace-pre-wrap break-all font-mono text-xs leading-6">{artifact.content}</pre>}
      </div>
    </aside>
  );
};

export type OriginPersonalAppProps = {
  onOpenSettings?: () => void;
  messages?: ConversationMessage[];
  onMessagesChange?: (messages: ConversationMessage[]) => void;
  resetSignal?: number;
};

export const App: React.FC<OriginPersonalAppProps> = ({ onOpenSettings, messages: controlledMessages, onMessagesChange, resetSignal = 0 }) => {
  const [uncontrolledMessages, setUncontrolledMessages] = useState<ConversationMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactBlock | null>(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const observedResetSignal = useRef(resetSignal);
  const messages = controlledMessages ?? uncontrolledMessages;
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const updateMessages = (updater: (current: ConversationMessage[]) => ConversationMessage[]) => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setUncontrolledMessages(next);
    onMessagesChange?.(next);
    return next;
  };

  const resetConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInputText('');
    setActiveArtifact(null);
    setIsWorkspaceOpen(false);
    updateMessages(() => []);
  };

  useEffect(() => {
    if (observedResetSignal.current === resetSignal) return;
    observedResetSignal.current = resetSignal;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInputText('');
    setActiveArtifact(null);
    setIsWorkspaceOpen(false);
  }, [resetSignal]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 44), 160)}px`;
  }, [inputText]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isLoading) return;

    const userMessage: ConversationMessage = { id: `u-${Date.now()}`, role: 'user', content: text.trim() };
    const conversation = updateMessages((current) => [...current, userMessage]);
    setInputText('');
    setIsLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'google/gemma-4-26b-a4b-it:free',
          systemPrompt: 'あなたは世界最高峰の知能「ORIGIN Personal 2.0」です。冒頭に結論を即答し、論理的に構造化して回答してください。コード等は ```language:title 形式で出力してください。',
          messages: conversation.map((message) => ({ role: message.role, content: message.content })),
        }),
      });
      if (!response.ok) throw new Error('通信エラー');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      const assistantId = `a-${Date.now()}`;
      updateMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        const parsed = StreamArtifactParser.parse(fullText);
        updateMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: parsed.conversationalText } : message));
        if (parsed.activeArtifact) {
          setActiveArtifact(parsed.activeArtifact);
          setIsWorkspaceOpen(true);
        }
      }
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        updateMessages((current) => [...current, { id: `err-${Date.now()}`, role: 'assistant', content: 'エラーが発生しました。再度お試しください。' }]);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const starterCards = [
    { title: '整理する', subtitle: '即時ロジック設計', desc: '断片的な考えから、次の一歩を明確にする', prompt: '以下の内容を整理し、結論先行で構造化してください:\n' },
    { title: '比較する', subtitle: 'ディープリサーチ', desc: '候補の違いと判断基準を見える形にする', prompt: '以下の候補について多角的な基準で比較分析してください:\n' },
    { title: '文章にする', subtitle: 'セキュア成果物', desc: 'メモを、伝わる文章・コードへ整える', prompt: '以下の内容を洗練された文章とWeb成果物に整えてください:\n' },
    { title: '計画する', subtitle: 'データ構造化', desc: '目的から、実行できる順序を組み立てる', prompt: '以下の目的を達成するための具体的実行計画を立ててください:\n' },
  ];

  return (
    <div className="origin-app flex h-[100dvh] w-screen overflow-hidden font-sans">
      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header className="origin-header flex min-h-16 items-center justify-between border-b px-3 backdrop-blur-md sm:px-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-primary)] shadow-[0_0_10px_var(--accent-glow)]" aria-hidden="true" />
            <span className="text-sm font-extrabold tracking-tight">ORIGIN</span>
            <span className="origin-badge rounded-md border px-1.5 py-0.5 text-[10px] font-mono">Personal 2.0</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onOpenSettings} aria-label="設定を開く" className="origin-secondary-button rounded-xl border px-3 text-xs font-semibold">⚙️ 設定</button>
            <button type="button" onClick={resetConversation} aria-label="新規対話を開始" className="origin-secondary-button rounded-xl border px-3 text-xs font-semibold">新規対話</button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center py-4">
              <div data-testid="origin-core-logo" className="relative mb-4 flex h-16 w-16 items-center justify-center">
                <div className="origin-logo-glow absolute inset-0 rounded-2xl blur-md" />
                <div className="origin-logo-core relative flex h-14 w-14 items-center justify-center rounded-2xl border shadow-xl"><svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg></div>
              </div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--accent-primary)]">ORIGIN</div>
              <h1 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">何を実現したいですか？</h1>
              <p className="origin-muted mt-2 max-w-lg text-center text-xs leading-relaxed sm:text-sm">考えがまとまっていなくても構いません。目的と条件を一緒に整理し、次の一歩が見える形に整えます。</p>
              <div className="origin-surface mt-6 w-full max-w-xl rounded-2xl border p-4">
                <textarea aria-label="実現したいことを入力" data-testid="origin-home-request" value={inputText} onChange={(event) => setInputText(event.target.value)} placeholder="実現したいこと、迷っていること、途中のメモをそのまま入力" rows={2} className="origin-input w-full resize-none bg-transparent text-sm focus:outline-none" />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border-default)] pt-3">
                  <span className="origin-safe-note text-[11px]">🛡️ 個人情報、社外秘、パスワード、APIキーは入力しないでください。</span>
                  <button type="button" data-testid="start-request-button" aria-label="依頼を開始" onClick={() => void handleSend()} disabled={!inputText.trim() || isLoading} className="origin-primary-button shrink-0 rounded-xl px-4 text-xs font-bold">始める →</button>
                </div>
              </div>
              <div className="mt-6 w-full max-w-xl"><div className="origin-muted mb-2 text-xs font-semibold">始め方を選ぶ</div><div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{starterCards.map((card, index) => <button key={card.title} type="button" data-testid={`starter-${index}`} onClick={() => void handleSend(card.prompt)} className="origin-card group flex min-h-28 flex-col rounded-xl border p-3 text-left transition"><span className="flex items-center justify-between gap-2"><span className="text-xs font-bold group-hover:text-[var(--accent-primary)]">{card.title}</span><span className="text-[10px] font-mono text-[var(--accent-primary)]">{card.subtitle}</span></span><span className="origin-muted mt-1 text-[11px]">{card.desc}</span></button>)}</div></div>
              <div className="origin-safe-note mt-6 text-center text-[11px]">現在は無料AIのみを使用し、有料AIへ自動で切り替えません。</div>
            </div>
          ) : (
            <div role="log" aria-label="会話履歴" aria-live="off" aria-busy={isLoading} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 pb-8">
              {messages.map((message) => <article key={message.id} aria-label={message.role === 'user' ? 'あなたの依頼' : 'ORIGINの回答'} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] rounded-2xl border px-4 py-3 text-sm leading-relaxed sm:max-w-[76%] ${message.role === 'user' ? 'origin-chat-user border-transparent' : 'origin-chat-assistant'}`}><p className="m-0 whitespace-pre-wrap break-all">{message.content || (isLoading && message.role === 'assistant' ? '考えています…' : '')}</p></div></article>)}
              {messages.some((message) => message.role === 'assistant' && !isLoading) && <p data-testid="response-announcement" role="status" className="sr-only">ORIGINの回答が届きました</p>}
            </div>
          )}
        </div>

        {messages.length > 0 && <div className="mx-auto w-full max-w-3xl px-4 pb-4"><div className="origin-surface flex items-end gap-2 rounded-2xl border p-2 focus-within:border-[var(--accent-primary)]"><textarea ref={textareaRef} aria-label="ORIGINへの依頼" aria-describedby="origin-chat-guidance" data-testid="origin-chat-request" value={inputText} onChange={(event) => setInputText(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void handleSend(); } }} placeholder="ORIGIN に指示を入力... (⌘+Enter で送信)" rows={1} disabled={isLoading} className="origin-input max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-sm focus:outline-none" /><p id="origin-chat-guidance" className="sr-only">ControlまたはCommandとEnterで送信できます。パスワードやAPIキーは入力しないでください。</p>{isLoading ? <button type="button" aria-label="生成を停止" onClick={() => abortRef.current?.abort()} className="origin-danger-button rounded-xl border px-4 text-xs font-bold">停止</button> : <button type="button" aria-label="依頼を送信" onClick={() => void handleSend()} disabled={!inputText.trim()} className="origin-primary-button rounded-xl px-4 text-xs font-bold">送信</button>}</div></div>}
      </main>
      <ArtifactWorkspace artifact={activeArtifact} isOpen={isWorkspaceOpen} onClose={() => setIsWorkspaceOpen(false)} />
    </div>
  );
};

export default App;
