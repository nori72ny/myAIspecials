import React, { useState, useRef, useEffect, useMemo } from 'react';

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
        if (trailingFenceCheck) {
          const safeEnd = normalized.length - trailingFenceCheck[1].length;
          conversationalText += normalized.slice(cursor, safeEnd);
        } else {
          conversationalText += normalized.slice(cursor);
        }
        break;
      }

      const matchIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
      conversationalText += normalized.slice(cursor, matchIndex);

      const rawLang = (match[1] || 'text').trim().toLowerCase();
      const rawTitle = (match[2] || '').trim();
      const safeTitle = rawTitle.slice(0, 100).replace(/[\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '').trim() || `Artifact-${artifactIndex + 1}`;
      const contentStart = matchIndex + match[0].length - (match[0].startsWith('\n') ? 1 : 0);

      const closeFenceRegex = /(?:^|\n)```[ \t]*(?:\n|$)/g;
      closeFenceRegex.lastIndex = contentStart;
      const closeMatch = closeFenceRegex.exec(normalized);

      const artType = rawLang === 'html' || rawLang === 'svg' ? 'html' : rawLang === 'mermaid' ? 'mermaid' : rawLang === 'markdown' || rawLang === 'md' ? 'markdown' : 'code';
      const artId = `art-${artifactIndex++}`;

      if (!closeMatch) {
        artifacts.push({ id: artId, type: artType, title: safeTitle, language: rawLang, content: normalized.slice(contentStart), isComplete: false });
        cursor = normalized.length;
        break;
      } else {
        const contentEnd = closeMatch.index + (closeMatch[0].startsWith('\n') ? 1 : 0);
        artifacts.push({ id: artId, type: artType, title: safeTitle, language: rawLang, content: normalized.slice(contentStart, contentEnd), isComplete: true });
        cursor = closeMatch.index + closeMatch[0].length;
      }
    }

    return {
      conversationalText: conversationalText.trim(),
      artifacts,
      activeArtifact: artifacts.length > 0 ? artifacts[artifacts.length - 1] : null,
    };
  }
}

export const ArtifactWorkspace: React.FC<{ artifact: ArtifactBlock | null; isOpen: boolean; onClose: () => void }> = ({ artifact, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('code');
  const [copied, setCopied] = useState(false);

  const sandboxSrcDoc = useMemo(() => {
    if (!artifact || (artifact.type !== 'html' && artifact.language !== 'html' && artifact.language !== 'svg')) return '';
    const sanitized = artifact.content.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none';">
          <meta name="referrer" content="no-referrer" />
          <script>
            window.addEventListener('click', function(e) {
              var target = e.target;
              while (target && target.tagName !== 'A') target = target.parentElement;
              if (target && target.tagName === 'A') { e.preventDefault(); e.stopPropagation(); }
            }, true);
            window.open = function() { return null; };
          </script>
          <style>body { font-family: sans-serif; padding: 16px; margin: 0; }</style>
        </head>
        <body>${sanitized}</body>
      </html>
    `;
  }, [artifact]);

  if (!isOpen || !artifact) return null;
  const isRenderable = artifact.type === 'html' || artifact.language === 'html' || artifact.language === 'svg';

  return (
    <aside
      aria-label="成果物プレビューワークスペース"
      data-testid="artifact-workspace"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-800 bg-slate-900 shadow-2xl sm:w-[560px]"
    >
      <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-semibold">{artifact.language}</span>
        <h2 className="text-sm font-semibold truncate text-slate-200 flex-1 ml-2">{artifact.title}</h2>
        <div className="flex items-center gap-1">
          {isRenderable && (
            <div className="flex bg-slate-800 p-0.5 rounded-lg mr-2">
              <button type="button" aria-label="コードを表示" onClick={() => setActiveTab('code')} className={`px-2 py-1 text-xs rounded ${activeTab === 'code' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Code</button>
              <button type="button" aria-label="プレビューを表示" onClick={() => setActiveTab('preview')} className={`px-2 py-1 text-xs rounded ${activeTab === 'preview' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Preview</button>
            </div>
          )}
          <button type="button" aria-label="成果物をコピー" onClick={async () => { await navigator.clipboard.writeText(artifact.content); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-300">
            {copied ? '✓' : 'Copy'}
          </button>
          <button type="button" aria-label="成果物ワークスペースを閉じる" onClick={onClose} className="p-2 text-slate-400 hover:text-white">✕</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 bg-slate-950">
        {activeTab === 'preview' && isRenderable ? (
          <iframe title="Preview" srcDoc={sandboxSrcDoc} sandbox="allow-scripts" referrerPolicy="no-referrer" className="w-full h-full border-0 bg-white rounded-lg" />
        ) : (
          <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap word-break-all">{artifact.content}</pre>
        )}
      </div>
    </aside>
  );
};

export type OriginPersonalAppProps = {
  onOpenSettings?: () => void;
};

export const App: React.FC<OriginPersonalAppProps> = ({ onOpenSettings }) => {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; content: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactBlock | null>(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 44), 160)}px`;
    }
  }, [inputText]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isLoading) return;

    const userMsg = { id: `u-${Date.now()}`, role: 'user' as const, content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemma-4-26b-a4b-it:free',
          systemPrompt: 'あなたは世界最高峰の知能「ORIGIN Personal 2.0」です。冒頭に結論を即答し、論理的に構造化して回答してください。コード等は ```language:title 形式で出力してください。',
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error('通信エラー');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantFullText = '';
      const asstId = `a-${Date.now()}`;
      setMessages((prev) => [...prev, { id: asstId, role: 'assistant', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantFullText += decoder.decode(value, { stream: true });
        const parsed = StreamArtifactParser.parse(assistantFullText);

        setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: parsed.conversationalText } : m)));
        if (parsed.activeArtifact) {
          setActiveArtifact(parsed.activeArtifact);
          setIsWorkspaceOpen(true);
        }
      }
    } catch {
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: 'エラーが発生しました。再度お試しください。' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const starterCards = [
    { title: '整理する', subtitle: '即時ロジック設計', desc: '断片的な考えから、次の一歩を明確にする', prompt: '以下の内容を整理し、結論先行で構造化してください:\\n' },
    { title: '比較する', subtitle: 'ディープリサーチ', desc: '候補の違いと判断基準を見える形にする', prompt: '以下の候補について多角的な基準で比較分析してください:\\n' },
    { title: '文章にする', subtitle: 'セキュア成果物', desc: 'メモを、伝わる文章・コードへ整える', prompt: '以下の内容を洗練された文章とWeb成果物に整えてください:\\n' },
    { title: '計画する', subtitle: 'データ構造化', desc: '目的から、実行できる順序を組み立てる', prompt: '以下の目的を達成するための具体的実行計画を立ててください:\\n' },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-14 px-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="font-extrabold text-sm tracking-tight text-white">ORIGIN</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700">Personal 2.0</span>
          </div>
          <div className="flex items-center gap-2">
            {onOpenSettings && (
              <button type="button" onClick={onOpenSettings} aria-label="設定を開く" className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800">
                設定
              </button>
            )}
            {messages.length > 0 && (
              <button type="button" onClick={() => { setMessages([]); setActiveArtifact(null); setIsWorkspaceOpen(false); }} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">
                新規対話
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto w-full py-4">
              <div data-testid="origin-core-logo" className="relative mb-4 flex h-16 w-16 items-center justify-center">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-cyan-400 opacity-80 blur-md animate-pulse" />
                <div className="relative w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center shadow-xl">
                  <svg className="w-8 h-8 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </div>
              </div>

              <div className="text-xs font-semibold text-cyan-400 tracking-wider uppercase mb-1">ORIGIN</div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 text-center tracking-tight">何を実現したいですか？</h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-2 text-center max-w-lg leading-relaxed">
                考えがまとまっていなくても構いません。目的と条件を一緒に整理し、次の一歩が見える形に整えます。
              </p>

              <div className="w-full max-w-xl mt-6 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
                <textarea
                  aria-label="実現したいことを入力"
                  data-testid="origin-home-request"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="実現したいこと、迷っていること、途中のメモをそのまま入力"
                  rows={2}
                  className="w-full resize-none bg-transparent text-sm text-slate-100 placeholder-slate-400 focus:outline-none"
                />
                <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-300 flex items-center gap-1">
                    🛡️ 個人情報、社外秘、パスワード、APIキーは入力しないでください。
                  </span>
                  <button
                    type="button"
                    data-testid="start-request-button"
                    onClick={() => handleSend()}
                    disabled={!inputText.trim() || isLoading}
                    className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      inputText.trim() ? 'bg-cyan-500 text-slate-950 shadow-md' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    始める →
                  </button>
                </div>
              </div>

              <div className="w-full max-w-xl mt-6">
                <div className="text-xs text-slate-400 font-semibold mb-2">始め方を選ぶ</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {starterCards.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      data-testid={`starter-${i}`}
                      onClick={() => handleSend(c.prompt)}
                      className="group flex flex-col p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/90 border border-slate-800/80 hover:border-cyan-500/40 text-left transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200 group-hover:text-cyan-400">{c.title}</span>
                        <span className="text-[10px] text-cyan-300 font-mono">{c.subtitle}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 mt-1">{c.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-[11px] text-slate-300 mt-6 text-center">
                現在は無料AIのみを使用し、有料AIへ自動で切り替えません。
              </div>
            </div>
          ) : (
            <div
              role="log"
              aria-label="会話履歴"
              aria-live="off"
              aria-busy={isLoading}
              className="max-w-3xl w-full mx-auto space-y-4 pb-8 flex-1"
            >
              {messages.map((m) => (
                <article
                  key={m.id}
                  aria-label={m.role === 'user' ? 'あなたの依頼' : 'ORIGINの回答'}
                  className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === 'user' ? 'bg-cyan-600 text-white shadow-md' : 'bg-slate-900 border border-slate-800 text-slate-200'}`}>
                    <p className="whitespace-pre-wrap word-break-all">{m.content}</p>
                  </div>
                </article>
              ))}
              {messages.some((message) => message.role === 'assistant' && !isLoading) && (
                <p data-testid="response-announcement" role="status" className="sr-only">
                  ORIGINの回答が届きました
                </p>
              )}
            </div>
          )}
        </div>

        {messages.length > 0 && (
          <div className="w-full max-w-3xl mx-auto px-4 pb-4">
            <div className="flex items-end gap-2 p-2 rounded-2xl bg-slate-900 border border-slate-800 focus-within:border-cyan-500/50 shadow-lg">
              <textarea
                ref={textareaRef}
                aria-label="ORIGINへの依頼"
                aria-describedby="origin-chat-guidance"
                data-testid="origin-chat-request"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
                placeholder="ORIGIN に指示を入力... (⌘+Enter で送信)"
                rows={1}
                disabled={isLoading}
                className="flex-1 max-h-40 resize-none bg-transparent px-3 py-2 text-sm text-slate-100 placeholder-slate-400 focus:outline-none"
              />
              <p id="origin-chat-guidance" className="sr-only">ControlまたはCommandとEnterで送信できます。パスワードやAPIキーは入力しないでください。</p>
              <button
                type="button"
                aria-label="依頼を送信"
                onClick={() => handleSend()}
                disabled={!inputText.trim() || isLoading}
                className={`h-10 px-4 rounded-xl text-xs font-bold ${inputText.trim() ? 'bg-cyan-500 text-slate-950 shadow-md' : 'bg-slate-800 text-slate-600'}`}
              >
                送信
              </button>
            </div>
          </div>
        )}
      </main>

      <ArtifactWorkspace artifact={activeArtifact} isOpen={isWorkspaceOpen} onClose={() => setIsWorkspaceOpen(false)} />
    </div>
  );
};
export default App;