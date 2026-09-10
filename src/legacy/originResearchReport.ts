import type { OriginResearchSource } from './originResearchSource.js';

/** Extractive reporting: external text is evidence, never an executable instruction. */
export function buildResearchReport(sources: OriginResearchSource[], language: 'ja' | 'en') {
  const citations = sources.map((source, index) => ({
    id: `S${index + 1}`, url: source.url, title: source.title,
    evidenceLevel: source.evidenceLevel, retrievedAt: source.retrievedAt,
  }));
  const findings = sources.flatMap((source, index) => {
    const text = source.excerpt.trim();
    return text ? [{ text, citationIds: [citations[index].id] }] : [];
  });
  // Deliberately narrow: identical surrounding text with different numbers is a
  // review candidate, not a proven contradiction (dates/conditions may differ).
  const candidates: { citationIds: string[]; statements: string[]; status: 'needs-review' }[] = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i], b = sources[j];
      if (a.evidenceLevel !== 'page-verified' || b.evidenceLevel !== 'page-verified') continue;
      if (new URL(a.url).hostname === new URL(b.url).hostname) continue;
      const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      const left = normalize(a.excerpt), right = normalize(b.excerpt);
      const mask = (value: string) => value.replace(/\d+(?:[.,]\d+)*/g, '#');
      if (left !== right && /\d/.test(left) && mask(left) === mask(right)) {
        candidates.push({ citationIds: [citations[i].id, citations[j].id], statements: [a.excerpt, b.excerpt], status: 'needs-review' });
      }
    }
  }
  const citationIntegrity = findings.every(finding => finding.citationIds.every(id => citations.some(citation => citation.id === id)));
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]<>()!#|]/g, '\\$&');
  const heading = language === 'ja' ? '## 出典付き調査レポート（抽出方式）' : '## Cited research report (extractive)';
  const limits = language === 'ja'
    ? '取得文を出典別に整理しました。事実の真偽・意味上の一致は未検証です。数値差分は矛盾候補として扱い、断定しません。'
    : 'Retrieved passages are organized by source. Factual accuracy and semantic agreement remain unverified. Numeric differences are review candidates, not proven contradictions.';
  const markdown = [heading, limits, ...findings.map(finding => {
    const citation = citations.find(item => item.id === finding.citationIds[0])!;
    return `> ${escape(finding.text).replace(/\n/g, '\n> ')}\n\n[${citation.id}](${encodeURI(citation.url).replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  }), language === 'ja' ? `数値差分の確認候補: ${candidates.length}件` : `Numeric difference candidates: ${candidates.length}`,
  ...candidates.map(candidate => candidate.citationIds.join(' / ') + ' — needs-review')].join('\n\n');
  return {
    version: '1.1', mode: 'extractive' as const, status: 'needs-review' as const,
    citations, findings, contradictionCandidates: candidates,
    verification: { citationIntegrity, factualAccuracy: 'not-assessed', semanticConflict: 'not-assessed' },
    markdown,
  };
}
