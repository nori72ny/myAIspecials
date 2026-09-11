import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { searchRepositoryV14, type CodingSearchHitV14 } from '../src/agent/safeRepositorySearchV14.js';

// Fixed historical search implementation; both variants use current safe IO.
const baselineSha = '2b905df35747632bb408ff90b50e54cc9e6d87b3';
const temp = await mkdtemp(path.join(tmpdir(), 'origin-search-comparison-'));
type Scenario = { name: string; files: Record<string, string>; queries: string[]; expected: [string, string, number][] };
const noise = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`src/noise${index}.ts`, 'commonHandler();\n'.repeat(8)]));
const scenarios: Scenario[] = [
  { name: 'direct-symbol', files: { 'src/a.ts': 'export function calculateTotal() {}\n' }, queries: ['calculateTotal'], expected: [['src/a.ts', 'calculateTotal', 1]] },
  { name: 'late-rare-symbol', files: { ...noise, 'src/target.ts': 'rareImplementation();\n' }, queries: ['commonHandler', 'rareImplementation'], expected: [['src/target.ts', 'rareImplementation', 1]] },
  { name: 'second-query-same-file', files: { 'src/a.ts': 'commonHandler();\n'.repeat(12) + 'rareImplementation();\n' }, queries: ['commonHandler', 'rareImplementation'], expected: [['src/a.ts', 'rareImplementation', 13]] },
  { name: 'long-previous-line', files: { 'src/a.ts': '// ' + 'x'.repeat(4000) + '\ncalculateTotal();\n' }, queries: ['calculateTotal'], expected: [['src/a.ts', 'calculateTotal', 2]] },
  { name: 'long-matching-line', files: { 'src/a.ts': '// ' + 'x'.repeat(4000) + ' calculateTotal();\n' }, queries: ['calculateTotal'], expected: [['src/a.ts', 'calculateTotal', 1]] },
  { name: 'unicode-offset', files: { 'src/a.ts': '// ' + 'İ '.repeat(400) + 'calculateTotal();\n' }, queries: ['calculateTotal'], expected: [['src/a.ts', 'calculateTotal', 1]] },
  { name: 'japanese', files: { 'src/a.ts': '// 注文を保存\n' }, queries: ['注文を保存'], expected: [['src/a.ts', '注文を保存', 1]] },
  { name: 'literal-metacharacters', files: { 'src/a.ts': 'const pattern = "a.*b";\nconst other = "axxb";\n' }, queries: ['a.*b'], expected: [['src/a.ts', 'a.*b', 1]] },
];
try {
  const source = execFileSync('git', ['show', `${baselineSha}:src/agent/safeRepositorySearchV14.ts`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const baselineFile = path.join(temp, 'baseline.mjs');
  await build({ stdin: { contents: source, loader: 'ts', resolveDir: path.resolve('src/agent') }, bundle: true, platform: 'node', format: 'esm', outfile: baselineFile, logLevel: 'silent' });
  const baseline = (await import(pathToFileURL(baselineFile).href)).searchRepositoryV14 as typeof searchRepositoryV14;
  const rows = [];
  for (const [index, scenario] of scenarios.entries()) {
    const root = path.join(temp, String(index));
    await mkdir(path.join(root, 'src'), { recursive: true });
    for (const [file, content] of Object.entries(scenario.files)) await writeFile(path.join(root, file), content);
    const score = (hits: CodingSearchHitV14[]) => scenario.expected.filter(([file, literal, line]) => hits.some(hit => hit.path === file && hit.line === line && hit.excerpt.includes(literal))).length;
    const before = await baseline(root, scenario.queries, Object.keys(scenario.files));
    const after = await searchRepositoryV14(root, scenario.queries, Object.keys(scenario.files));
    rows.push({ scenario: scenario.name, expected: scenario.expected.length, before: score(before), after: score(after) });
  }
  console.log(JSON.stringify({ scope: 'synthetic development regression set, not a held-out AI benchmark', baselineSha, current: 'workspace search implementation', scoring: 'expected file, line and literal visible in returned evidence', rows, totals: { expected: rows.reduce((n, r) => n + r.expected, 0), before: rows.reduce((n, r) => n + r.before, 0), after: rows.reduce((n, r) => n + r.after, 0) } }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
