import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OriginLanguage } from '../../i18n';

type OriginAnswerMarkdownProps = {
  content: string;
  language: OriginLanguage;
  onRefine?: (prompt: string) => void;
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
export default function OriginAnswerMarkdown({ content, language, onRefine }: OriginAnswerMarkdownProps) {
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
        {onRefine && <div className="origin-answer-refinements" role="group" aria-label={language === 'en' ? 'Refine this answer' : '回答を調整'}>
          <button type="button" onClick={() => onRefine(language === 'en'
            ? 'Expand your previous answer with concrete reasoning, relevant conditions, and practical steps. Address missing detail without repeating the summary. Keep unverified points explicit.'
            : '直前の回答を、判断の理由・適用条件・実行手順まで具体的に掘り下げてください。要約の繰り返しではなく、不足している説明を補い、未確認の点は明示してください。')}>{language === 'en' ? 'More detail' : '詳しく説明'}</button>
          <button type="button" onClick={() => onRefine(language === 'en'
            ? 'Add a concrete, usable example to your previous answer that fits my request. Label any illustrative assumptions and do not present invented examples as actual results.'
            : '直前の回答に、私の依頼に合った、そのまま使える具体例を加えてください。仮定や例示は明示し、架空の事例を実績として扱わないでください。')}>{language === 'en' ? 'Add an example' : '具体例を追加'}</button>
          <button type="button" onClick={() => onRefine(language === 'en'
            ? 'Summarize your previous answer into the key conclusion and next action, preserving essential conditions and uncertainty.'
            : '直前の回答を、結論と次に行うことがすぐ分かる要点にまとめてください。判断に必要な条件と不確実性は残してください。')}>{language === 'en' ? 'Key points' : '要点だけ'}</button>
        </div>}
      </div>}
    </div>
  );
}
