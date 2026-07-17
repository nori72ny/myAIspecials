export function shouldUseAnswerQualityPreview(search: string): boolean {
  return new URLSearchParams(search).get('answerQuality') === '1';
}
