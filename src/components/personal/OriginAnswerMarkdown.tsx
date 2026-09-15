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

const refinementPrompt = (language: OriginLanguage, kind: 'depth' | 'example' | 'plan' | 'summary') => {
  if (language === 'en') {
    if (kind === 'depth') return 'Upgrade your previous answer to professional working depth. Keep the direct conclusion, then fill the material gaps with decision criteria, evidence or reasoning, relevant conditions, trade-offs, risks, concrete steps, verification, and explicit unknowns. Adapt the structure to the task: research needs sources/conditions/comparison logic; coding needs usable changes, integration, tests, and limitations; planning needs deliverables, dependencies, ownership, and completion criteria. Do not add filler or invent facts.';
    if (kind === 'example') return 'Add a concrete, directly usable example that fits my request and show how it connects to the recommendation. Label illustrative assumptions, preserve important constraints, and never present an invented example as an observed result.';
    if (kind === 'plan') return 'Turn the previous answer into an executable plan. Preserve the conclusion and constraints, then give the ordered actions, dependencies, decision points, verification for each material step, and a clear definition of done. For coding work, name the files or components to change and the tests/checks that prove completion. Do not invent completed work.';
    return 'Compress the previous answer to the decision-critical conclusion and next action. Preserve material conditions, risks, and uncertainty; remove repetition rather than removing necessary caveats.';
  }
  if (kind === 'depth') return '直前の回答を、実務でそのまま判断・実行に使える深さまで引き上げてください。結論は明確に保ちつつ、不足している判断基準、根拠、適用条件、比較、トレードオフ、リスク、具体手順、検証方法、未確認点を補ってください。依頼の種類に合わせ、調査なら出典・条件・比較理由、開発なら使える変更内容・組込み方・テスト・制約、計画なら成果物・依存関係・担当・完了条件を含めてください。文字数を増やすための一般論や、未確認の事実の創作はしないでください。';
  if (kind === 'example') return '直前の回答に、私の依頼に直接使える具体例を追加し、その例が結論や提案にどうつながるかまで示してください。仮定や例示は明示し、重要な条件を落とさず、架空の事例を実績として扱わないでください。';
  if (kind === 'plan') return '直前の回答を、実際に進められる実行プランに変換してください。結論と制約を維持し、実施順、依存関係、判断ポイント、各重要工程の検証方法、明確な完了条件まで示してください。開発作業なら変更対象のファイルやコンポーネント、完了を証明するテストやチェックも具体化してください。未実施の作業を完了済みとは書かないでください。';
  return '直前の回答を、意思決定に必要な結論と次の行動がすぐ分かる形に圧縮してください。重要な条件、リスク、不確実性は残し、必要情報ではなく重複を削ってください。';
};

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
          <button type="button" onClick={() => onRefine(refinementPrompt(language, 'depth'))}>{language === 'en' ? 'Professional depth' : '実務レベルに深掘り'}</button>
          <button type="button" onClick={() => onRefine(refinementPrompt(language, 'example'))}>{language === 'en' ? 'Add an example' : '具体例を追加'}</button>
          <button type="button" onClick={() => onRefine(refinementPrompt(language, 'plan'))}>{language === 'en' ? 'Make a plan' : '実行プランにする'}</button>
          <button type="button" onClick={() => onRefine(refinementPrompt(language, 'summary'))}>{language === 'en' ? 'Key points' : '要点だけ'}</button>
        </div>}
      </div>}
    </div>
  );
}
