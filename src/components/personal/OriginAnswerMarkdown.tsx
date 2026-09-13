import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OriginLanguage } from '../../i18n';

type OriginAnswerMarkdownProps = {
  content: string;
  language: OriginLanguage;
};

function CopyButton({ text, language, label }: { text: string; language: OriginLanguage; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  return <span className="origin-copy-control">
    <button type="button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setStatus('copied');
      } catch { setStatus('failed'); }
    }}>{label}</button>
    <span role="status" aria-live="polite">{status === 'copied'
      ? (language === 'en' ? 'Copied' : 'コピーしました')
      : status === 'failed' ? (language === 'en' ? 'Select and copy the text manually.' : '本文を選択してコピーしてください。') : ''}</span>
  </span>;
}

function AnswerCodeBlock({ children, language }: { children: ReactNode; language: OriginLanguage }) {
  const [wrap, setWrap] = useState(false);
  const child = Children.toArray(children)[0];
  const props = isValidElement<{ children?: ReactNode; className?: string }>(child) ? child.props : undefined;
  const code = typeof props?.children === 'string' ? props.children : '';
  const codeLanguage = props?.className?.match(/language-([\w+-]+)/)?.[1] ?? (language === 'en' ? 'Code' : 'コード');
  return <section className="origin-answer-code" aria-label={language === 'en' ? 'Code block' : 'コードブロック'}>
    <div className="origin-answer-code-toolbar">
      <span>{codeLanguage}</span>
      <div>
        <button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>{language === 'en' ? 'Wrap lines' : '折り返し'}</button>
        <CopyButton text={code} language={language} label={language === 'en' ? 'Copy code' : 'コードをコピー'} />
      </div>
    </div>
    <pre tabIndex={0} className={wrap ? 'origin-code-wrap' : undefined}>{children}</pre>
  </section>;
}

/**
 * Renders model-authored Markdown without enabling raw HTML or automatic
 * external image loading. Semantic elements are styled in index.css so long
 * answers remain readable on narrow screens.
 */
export default function OriginAnswerMarkdown({ content, language }: OriginAnswerMarkdownProps) {
  return (
    <div className="origin-answer-markdown markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <AnswerCodeBlock language={language}>{children}</AnswerCodeBlock>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          ),
          img: ({ alt }) => (
            <span role="note" className="origin-external-image-note">
              {language === 'en'
                ? `External image not loaded automatically${alt ? `: ${alt}` : ''}`
                : `外部画像は自動表示しません${alt ? `：${alt}` : ''}`}
            </span>
          ),
          table: ({ children }) => (
            <div className="origin-answer-table-scroll" role="region" aria-label={language === 'en' ? 'Scrollable answer table' : '横にスクロールできる回答表'} tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {content.trim() && <div className="origin-answer-actions">
        <CopyButton text={content} language={language} label={language === 'en' ? 'Copy answer' : '回答をコピー'} />
      </div>}
    </div>
  );
}
