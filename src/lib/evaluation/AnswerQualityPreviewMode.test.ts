import { describe, expect, it } from 'vitest';
import { shouldUseAnswerQualityPreview } from './AnswerQualityPreviewMode';

describe('shouldUseAnswerQualityPreview', () => {
  it('enables the preview only for answerQuality=1', () => {
    expect(shouldUseAnswerQualityPreview('?answerQuality=1')).toBe(true);
    expect(shouldUseAnswerQualityPreview('?delegationV2=1&answerQuality=1')).toBe(true);
    expect(shouldUseAnswerQualityPreview('?answerQuality=0')).toBe(false);
    expect(shouldUseAnswerQualityPreview('')).toBe(false);
  });
});
