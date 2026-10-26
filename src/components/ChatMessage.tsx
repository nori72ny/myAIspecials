import React, { useState } from 'react';

export interface SourceCitation {
  id?: string;
  title: string;
  url: string;
  snippet?: string;
  domain?: string;
}

export interface FluxImageData {
  url: string;
  alt?: string;
  prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  sha256?: string;
}

export interface CodeArtifactData {
  id?: string;
  title: string;
  language: string;
  content: string;
}

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingSteps?: string[];
  citations?: SourceCitation[];
  image?: FluxImageData;
  artifact?: CodeArtifactData;
}

export const ThinkingStepIndicator: React.FC<{ steps: string[]; isExpandedDefault?: boolean }> = ({
  steps,
  isExpandedDefault = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(isExpandedDefault);

  if (!steps || steps.length === 0) return null;

  return (
    <div data-testid="thinking-step-indicator" className="my-2 rounded-xl border border-indigo-500/20 bg-indigo-50/50 p-3 text-sm dark:bg-indigo-950/30">
      <button
        type="button"
        data-testid="thinking-toggle-button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between font-semibold text-indigo-700 dark:text-indigo-300"
      >
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          思考ステップ ({steps.length} 件)
        </span>
        <span>{isExpanded ? '▲ 隠す' : '▼ 表示'}</span>
      </button>

      {isExpanded && (
        <ol data-testid="thinking-steps-list" className="mt-2.5 space-y-1.5 border-t border-indigo-500/10 pt-2 pl-4 text-xs list-decimal text-indigo-900 dark:text-indigo-200">
          {steps.map((step, idx) => (
            <li key={idx} className="leading-relaxed">
              {step}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export const SourceCitationCard: React.FC<{ citations: SourceCitation[] }> = ({ citations }) => {
  if (!citations || citations.length === 0) return null;

  return (
    <div data-testid="source-citation-card" className="my-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface-muted)] p-3 text-xs">
      <div className="mb-2 font-semibold text-[var(--text-secondary)]">引用元・参照データ</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {citations.map((cite, index) => (
          <a
            key={cite.id || index}
            href={cite.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`citation-item-${index}`}
            className="flex flex-col rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 transition hover:border-[var(--accent-primary)] hover:shadow-sm"
          >
            <span className="font-semibold text-[var(--accent-primary)] truncate">{cite.title}</span>
            {cite.snippet && <span className="mt-1 line-clamp-2 text-[var(--text-secondary)]">{cite.snippet}</span>}
            <span className="mt-1 text-[10px] text-[var(--text-placeholder)] truncate">{cite.domain || cite.url}</span>
          </a>
        ))}
      </div>
    </div>
  );
};

export const FluxImageCard: React.FC<{ image: FluxImageData }> = ({ image }) => {
  if (!image || !image.url) return null;

  return (
    <figure data-testid="flux-image-card" className="my-3 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 shadow-sm">
      <img
        src={image.url}
        alt={image.alt || image.prompt || 'Generated AI Image'}
        data-testid="flux-image"
        className="block h-auto max-h-[500px] w-full rounded-xl object-contain"
      />
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--text-secondary)]">
        <span className="truncate">
          {image.model || 'Flux/Free Model'} {image.width && image.height ? `· ${image.width}×${image.height}` : ''}
        </span>
        {image.prompt && (
          <span className="italic truncate max-w-[280px]" title={image.prompt}>
            &quot;{image.prompt}&quot;
          </span>
        )}
      </figcaption>
    </figure>
  );
};

export const LiveSandbox: React.FC<{ artifact: CodeArtifactData }> = ({ artifact }) => {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');

  if (!artifact) return null;

  const isHtml = artifact.language.toLowerCase() === 'html' || artifact.language.toLowerCase() === 'svg';

  return (
    <div data-testid="live-sandbox" className="my-3 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-md">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-surface-muted)] px-3 py-2 text-xs font-semibold">
        <span className="flex items-center gap-2 truncate">
          <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent-primary)] uppercase">{artifact.language}</span>
          <span>{artifact.title}</span>
        </span>
        {isHtml && (
          <div className="flex rounded-lg bg-[var(--bg-primary)] p-0.5 border border-[var(--border-default)]">
            <button
              type="button"
              data-testid="sandbox-tab-preview"
              onClick={() => setTab('preview')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${tab === 'preview' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-secondary)]'}`}
            >
              プレビュー
            </button>
            <button
              type="button"
              data-testid="sandbox-tab-code"
              onClick={() => setTab('code')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${tab === 'code' ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-secondary)]'}`}
            >
              ソース
            </button>
          </div>
        )}
      </div>

      <div className="p-3">
        {isHtml && tab === 'preview' ? (
          <iframe
            title={artifact.title}
            data-testid="sandbox-preview-iframe"
            srcDoc={artifact.content}
            sandbox="allow-scripts"
            className="h-64 w-full rounded-xl border border-[var(--border-default)] bg-white"
          />
        ) : (
          <pre data-testid="sandbox-code-block" className="max-h-80 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-slate-100 leading-relaxed">
            <code>{artifact.content}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

export const ChatMessage: React.FC<{ message: ChatMessageData }> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <article
      data-testid={`chat-message-${message.id}`}
      className={`my-3 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div
        className={`w-full max-w-3xl rounded-2xl p-4 leading-relaxed ${
          isUser
            ? 'bg-[var(--accent-primary)] text-white self-end max-w-[85%]'
            : 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)]'
        }`}
      >
        {/* Thinking Steps */}
        {!isUser && message.thinkingSteps && message.thinkingSteps.length > 0 && (
          <ThinkingStepIndicator steps={message.thinkingSteps} />
        )}

        {/* Text Content */}
        <div data-testid="message-content" className="whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {/* Inline Image Card */}
        {!isUser && message.image && <FluxImageCard image={message.image} />}

        {/* Inline Live Sandbox Code Preview */}
        {!isUser && message.artifact && <LiveSandbox artifact={message.artifact} />}

        {/* Inline Source Citations */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <SourceCitationCard citations={message.citations} />
        )}
      </div>
    </article>
  );
};

export default ChatMessage;
