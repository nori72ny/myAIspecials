import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the workflow's actual inline classifier with a synthetic Actions API response.
// No provider, private corpus, credentials, or network access is involved.
const workflow = readFileSync(new URL('../.github/workflows/frontier-coding-status-audit.yml', import.meta.url), 'utf8');
const code = workflow.split("node <<'NODE'\n")[1].split('\n          NODE')[0];
function classify(names, conclusion = 'success', options = {}) {
  let report;
  const artifacts = names.map(name => ({ name, expired: options.expired ?? false }));
  runInNewContext(code, {
    require: () => ({
      readFileSync: () => JSON.stringify({ artifacts, total_count: options.total ?? artifacts.length }),
      mkdirSync() {}, appendFileSync() {},
      writeFileSync: (_, data) => { report = JSON.parse(data); },
    }),
    process: { env: { SOURCE_CONCLUSION: conclusion, SOURCE_SHA: 'a'.repeat(40), SOURCE_RUN_ID: '123' } },
  });
  return report;
}
assert.equal(classify([]).status, 'NOT_MEASURED');
assert.equal(classify([], 'failure').status, 'FAILED');
assert.equal(classify(['origin-held-out-final-started-digest']).reason, 'STARTED_WITHOUT_FINAL_EVIDENCE');
assert.equal(classify(['origin-held-out-final-task-case-123'], 'cancelled').status, 'FAILED');
assert.equal(classify(['origin-held-out-final-evidence-digest']).status, 'QUALIFIED');
assert.equal(classify(['origin-held-out-final-evidence-digest'], 'failure').status, 'FAILED');
assert.equal(classify(['origin-held-out-final-evidence-digest'], 'success', { expired: true }).status, 'NOT_MEASURED');
assert.throws(() => classify([], 'success', { total: 101 }), /Incomplete artifact inventory/);
assert.equal(classify(['unrelated-artifact']).status, 'NOT_MEASURED');
console.log('Frontier audit: 9 regression checks passed');
