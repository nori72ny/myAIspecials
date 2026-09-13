import ReactMarkdown from 'react-markdown';
import type { OriginLanguage } from '../../i18n';

type OriginAnswerMarkdownProps = {
  content: string;
  language: OriginLanguage;
};

/**
 * Renders model-authored Markdown without enabling raw HTML or automatic
 * external image loading. Semantic elements are styled in index.css so long
 * answers remain readable on narrow screens.
 */
export default function OriginAnswerMarkdown({ content, language }: OriginAnswerMarkdownProps) {
  return (
    <div className="origin-answer-markdown markdown-body">
      <ReactMarkdown
        components={{
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
    </div>
  );
}
