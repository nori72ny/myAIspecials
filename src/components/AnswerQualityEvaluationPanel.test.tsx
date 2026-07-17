import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnswerQualityEvaluationPanel from './AnswerQualityEvaluationPanel';

describe('AnswerQualityEvaluationPanel', () => {
  it('renders an accessible localized preview launcher', () => {
    const html = renderToStaticMarkup(<AnswerQualityEvaluationPanel />);

    expect(html).toContain('回答品質を評価');
    expect(html).toContain('data-testid="answer-quality-preview-open"');
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('APIキーを入力');
  });
});
