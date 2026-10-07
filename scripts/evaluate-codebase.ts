import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Read immutable Git objects: never collect local credentials, runtime output,
// untracked files, or working-tree edits into an external review packet.
const git = (...args: string[]) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const sha = git('rev-parse', '--verify', 'HEAD^{commit}').toString().trim();
const entries = git('ls-tree', '-r', '-z', sha).toString().split('\0').filter(Boolean);
const selected: string[] = [];
const omitted: string[] = [];
for (const entry of entries) {
  const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
  if (!match) { omitted.push(entry); continue; }
  const [, mode, , name] = match;
  const scope = name === 'docs/reviews/code-quality-submission-20261007.md' || /^(src|services|api|packages|tests|scripts|\.github\/workflows)\//.test(name) || !name.includes('/');
  const text = /\.(?:[cm]?[jt]sx?|json|ya?ml|css|html|md|toml|jsonc)$/.test(name);
  const sensitive = /(?:^|\/)(?:\.env[^/]*|[^/]*\.(?:pem|key|p12|pfx)|[^/]*(?:sealed|private-corpus)[^/]*)$/i.test(name);
  if (mode !== '100644' && mode !== '100755' || !scope || !text || sensitive || name === 'THIRD_PARTY_EVALUATION_BUNDLE.md') {
    omitted.push(name); continue;
  }
  selected.push(name);
}
selected.sort();
omitted.sort();
const out = join('results', 'code-review', sha);
mkdirSync(out, { recursive: true });
const manifest: { path: string; bytes: number; sha256: string }[] = [];
const chunks = [
  '# ORIGIN code review submission\n',
  `Source commit: ${sha}\n`,
  'Source: committed Git objects only. Working-tree changes are not included.\n',
  'This packet is review input, not a quality certificate. Test, security, live provider and output-quality claims require separate evidence tied to this commit.\n',
  'Review server/API authorization, free-only enforcement, secret handling, generated-code isolation, cancellation, truthful completion, dependency risks, tests and CI. Report severity, file/line, reproduction, impact and remediation. Mark untested claims NOT VERIFIED. Do not run live inference or paid evaluation scripts.\n',
  'Scope and omissions are recorded in manifest.json. No automated selection can certify absence of secrets in committed source; scan and inspect before sharing externally.\n',
];
for (const name of selected) {
  const bytes = git('show', `${sha}:${name}`);
  const content = bytes.toString('utf8');
  manifest.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const runs = content.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  chunks.push(`\n## ${name}\n\n${fence}\n${content}\n${fence}\n`);
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ schemaVersion: 1, sourceCommit: sha, source: 'git-objects', files: manifest, omitted }, null, 2) + '\n');
writeFileSync(join(out, 'THIRD_PARTY_EVALUATION_BUNDLE.md'), chunks.join('\n'));
console.log(`Prepared ${selected.length} committed files at ${out}; ${omitted.length} entries omitted. Source ${sha}.`);
