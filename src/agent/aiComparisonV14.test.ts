// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { COMPARISON_CATEGORIES, COMPARISON_TASKS, COMPARISON_VERSION, comparisonPrompt, comparisonReport, compareAIResponses, scoreComparisonResponse } from './aiComparisonV14.js';
const response = (): { suite: string; answers: Record<string, unknown> } => ({ suite: COMPARISON_VERSION, answers: Object.fromEntries(COMPARISON_TASKS.map(task => [task.id, task.expected])) });
describe('offline cross-AI comparison', () => {
  it('exports the same tasks without the answer key', () => {
    expect(comparisonPrompt()).toContain('verification-truth');
    expect(comparisonPrompt()).not.toContain('"total":480');
  });
  it('scores structured answers independently of object key order', () => {
    const data = response();
    data.answers['conflicting-sources'] = { sources: ['S2', 'S1'], values: [12, 15], status: 'conflict' };
    expect(scoreComparisonResponse(JSON.stringify(data), 'reference', 'rubric-visible reference')).toMatchObject({ passed: 16, total: 16, formatValid: true });
  });
  it('keeps unanswered tasks in the denominator', () => {
    const data = response(); delete data.answers['aggregation'];
    expect(scoreComparisonResponse(JSON.stringify(data), 'candidate', 'manual')).toMatchObject({ passed: 15, total: 16 });
  });
  it.each(['not JSON', '```json\n{}\n```', 'null', '{"suite":"wrong","answers":{}}'])('records invalid output as failure', text => {
    expect(scoreComparisonResponse(text, 'candidate', 'manual')).toMatchObject({ passed: 0, total: 16, formatValid: false });
  });
  it('does not accept an unsupported success assertion', () => {
    const data = response(); data.answers['verification-truth'] = { complete: true, unverified: [] };
    expect(scoreComparisonResponse(JSON.stringify(data), 'candidate', 'manual').passed).toBe(15);
  });
  it('rejects missing provenance and oversized input', () => {
    expect(() => scoreComparisonResponse('{}', '', 'manual')).toThrow();
    expect(() => scoreComparisonResponse('x'.repeat(128 * 1024 + 1), 'candidate', 'manual')).toThrow('COMPARISON_INPUT_LIMIT');
  });
  it('compares supplied participants without dropping invalid answers or inventing absent models', () => {
    const entries = [
      { participant: 'A', provenance: 'manual fixture', response: JSON.stringify(response()) },
      { participant: 'B', provenance: 'manual fixture', response: 'invalid response' },
    ];
    expect(compareAIResponses(JSON.stringify(entries)).map(row => [row.participant, row.passed, row.total])).toEqual([['A', 16, 16], ['B', 0, 16]]);
    expect(() => compareAIResponses(JSON.stringify([entries[0], entries[0]]))).toThrow('COMPARISON_DUPLICATE_PARTICIPANT');
  });
  it('reports missing answers and escapes participant formatting without disclosing answers', () => {
    const report = comparisonReport(JSON.stringify([{ participant: 'A|B\n<img>', provenance: 'manual', response: 'PRIVATE_RAW_RESPONSE' }]));
    expect(report).toContain('0/16');
    expect(report).toContain('形式不正');
    expect(report).toContain('A\\|B &lt;img&gt;');
    expect(report).not.toContain('PRIVATE_RAW_RESPONSE');
    expect(report).toContain('再確認する課題');
  });
  it('reports four balanced categories without turning them into a general model ranking', () => {
    const scored = scoreComparisonResponse(JSON.stringify(response()), 'reference', 'manual fixture');
    expect(scored.categoryScores).toEqual(Object.keys(COMPARISON_CATEGORIES).map(category => ({ category, passed: 4, total: 4 })));
    const report = comparisonReport(JSON.stringify([{ participant: 'ORIGIN', provenance: 'manual fixture', response: JSON.stringify(response()) }]));
    for (const label of Object.values(COMPARISON_CATEGORIES)) expect(report).toContain(label);
    expect(report).toContain('総合性能の順位ではありません');
    expect(report).toContain('大規模repository編集');
  });
});
