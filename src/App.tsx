import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

// ==========================================
// 1. 高堅牢 ストリーミング成果物パーサー (独立監査 FINAL PASS)
// ==========================================
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

class StreamArtifactParser {
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

// ==========================================
// 2. 世界最高峰 トップ画面ビュー (PersonalTopView)
// ==========================================
const PersonalTopView: React.FC<{ onQuickPrompt: (prompt: string) => void }> = ({ onQuickPrompt }) => {
  const quickActions = [
    { title: '即時ロジック設計', desc: '複雑な課題を結論先行で構造化・分解', prompt: '以下の課題について結論先行で構造化して解決策を提示してください:\n' },
    { title: 'セキュアWeb成果物', desc: '分離プレビューで動くHTML/JSを即時生成', prompt: '以下の仕様を満たす美しいインタラクティブWebアプリ（HTML/CSS/JS単一コード）を作成してください:\n' },
    { title: 'ディープリサーチ分析', desc: '多角的な視点からファクトを比較・検証', prompt: '以下のテーマについて多角的な視点でファクトを精査し、比較分析してください:\n' },
    { title: 'データ構造化・変換', desc: '非構造テキストを厳格なJSON/TS型へ変換', prompt: '以下のテキストから重要データを抽出し、TypeScript型付きJSONに構造化してください:\n' },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-4xl mx-auto w-full select-none">
      <div className="flex flex-col items-center mb-8">
        <div className="relative w-20 h-20 mb-4 flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-cyan-400 opacity-80 blur-lg animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center shadow-2xl">
            <svg className="w-9 h-9 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 font-sans">
          ORIGIN <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 ml-1.5 align-middle">Personal 2.0</span>
        </h1>
        <p className="text-sm text-slate-400 mt-2 text-center max-w-md font-sans">
          思考の透明化・完全ローカル主権・世界最高峰の応答体験
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {quickActions.map((action, idx) => (
          <button
            key={idx}
            onClick={() => onQuickPrompt(action.prompt)}
            className="group flex flex-col p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 shadow-sm hover:shadow-md transition-all duration-200 text-left cursor-pointer min-h-[72px]"
          >
            <span className="text-sm font-bold text-slate-200 group-hover:text-cyan-400 transition-colors flex items-center justify-between">
              {action.title}
              <span className="text-xs text-slate-500 group-hover:translate-x-0.5 transition-transform">→</span>
            </span>
            <span className="text-xs text-slate-400 mt-1">{action.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ==========================================
// 3. セキュア成果物ワークスペース (ArtifactWorkspace)
// ==========================================
const ArtifactWorkspace: React.FC<{ artifact: ArtifactBlock | null; isOpen: boolean; onClose: () => void }> = ({ artifact, isOpen, onClose }) => {
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
    <aside className="fixed inset-y-0 right-0 w-full sm:w-[560px] bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col z-50">
      <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-semibold">{artifact.language}</span>
        <h2 className="text-sm font-semibold truncate text-slate-200 flex-1 ml-2">{artifact.title}</h2>
        <div className="flex items-center gap-1">
          {isRenderable && (
            <div className="flex bg-slate-800 p-0.5 rounded-lg mr-2">
              <button onClick={() => setActiveTab('code')} className={`px-2 py-1 text-xs rounded ${activeTab === 'code' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Code</button>
              <button onClick={() => setActiveTab('preview')} className={`px-2 py-1 text-xs rounded ${activeTab === 'preview' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Preview</button>
            </div>
          )}
          <button onClick={async () => { await navigator.clipboard.writeText(artifact.content); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-300">
            {copied ? '✓' : 'Copy'}
          </button>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white">✕</button>
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

// ==========================================
// 4. インテリジェント自動伸縮 入力欄 (ChatInputArea)
// ==========================================
const ChatInputArea: React.FC<{ onSendMessage: (msg: string) => void; isLoading: boolean; onStop: () => void }> = ({ onSendMessage, isLoading, onStop }) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 44), 180)}px`;
    }
  }, [text]);

  const handleSubmit = () => {
    if (!text.trim() || isLoading) return;
    onSendMessage(text.trim());
    setText('');
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-4">
      <div className="flex items-end gap-2 p-2 rounded-2xl bg-slate-900 border border-slate-800 focus-within:border-cyan-500/50 shadow-lg">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
          placeholder="ORIGIN に指示を入力... (⌘+Enter で送信)"
          rows={1}
          disabled={isLoading}
          className="flex-1 max-h-44 resize-none bg-transparent px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-sans"
        />
        {isLoading ? (
          <button onClick={onStop} className="h-10 w-10 rounded-xl bg-slate-800 text-rose-400 flex items-center justify-center">■</button>
        ) : (
          <button onClick={handleSubmit} disabled={!text.trim()} className={`h-10 px-4 rounded-xl text-xs font-bold transition-all ${text.trim() ? 'bg-cyan-500 text-slate-950 shadow-md' : 'bg-slate-800 text-slate-600'}`}>送信</button>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 5. メインアプリケーション (App)
// ==========================================
export const App: React.FC = () => {
  const [messages, setMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; content: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactBlock | null>(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg = { id: `u-${Date.now()}`, role: 'user' as const, content: text };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemma-4-26b-a4b-it:free',
          systemPrompt: 'あなたは世界最高峰の知能「ORIGIN Personal 2.0」です。冒頭に結論を即答し、構造化して回答してください。コードや成果物は ```language:title 形式で出力してください。',
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-14 px-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="font-extrabold text-sm tracking-tight">ORIGIN Personal</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">2.0</span>
          </div>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setActiveArtifact(null); setIsWorkspaceOpen(false); }} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300">
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
                <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-cyan-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-200'}`}>
                    <p className="whitespace-pre-wrap word-break-all">{m.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <ChatInputArea onSendMessage={handleSendMessage} isLoading={isLoading} onStop={() => setIsLoading(false)} />
      </main>

      <ArtifactWorkspace artifact={activeArtifact} isOpen={isWorkspaceOpen} onClose={() => setIsWorkspaceOpen(false)} />
    </div>
  );
};
export default App;                    }`}
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
