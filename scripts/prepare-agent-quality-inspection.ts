import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createAgentOrchestratorV3Router } from '../src/agent/agentOrchestratorV3.js';

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const originalCwd = process.cwd();
const git = (...args: string[]) => execFileSync('git', args, { cwd: originalCwd, encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
if (!/^[a-f0-9]{40}$/.test(sha) || git('status', '--porcelain=v1', '--untracked-files=all')) throw new Error('INSPECTION_CLEAN_COMMITTED_CANDIDATE_REQUIRED');
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw new Error('INSPECTION_ABSOLUTE_NEW_OUTPUT_DIRECTORY_REQUIRED');
const output = process.argv[2];
// Refuse an existing destination. Evidence must never silently overwrite a prior run.
await mkdir(output, { recursive: false, mode: 0o700 });
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'origin-agent-inspection-'));
const env = { ORIGIN_AGENT_APPROVAL_SECRET: randomBytes(48).toString('hex'), ORIGIN_AGENT_OPERATOR_SECRET: randomBytes(48).toString('hex') };
const consumed = new Set<string>();
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(createAgentOrchestratorV3Router(env, { consume: async id => { if (consumed.has(id)) return false; consumed.add(id); return true; } }));
const rows: Array<Record<string, unknown>> = [];
const files: Array<{ name: string; sha256: string; bytes: number }> = [];
async function save(name: string, content: string) {
  await writeFile(path.join(output, name), content, { flag: 'wx', mode: 0o600 });
  files.push({ name, sha256: hash(content), bytes: Buffer.byteLength(content) });
}
const post = (route: string, body: object, authenticated = true) => {
  const req = request(app).post('/api/agent/v3/' + route);
  if (authenticated) req.set('Authorization', `Bearer ${env.ORIGIN_AGENT_OPERATOR_SECRET}`);
  return req.send(body).timeout(10000);
};
async function prepare(goal: string, params: Record<string, unknown>) {
  const plan = await post('plan', { goal }, false);
  if (plan.status !== 201) throw new Error('INSPECTION_PLAN_FAILED');
  const operation = { runId: plan.body.runId, toolName: plan.body.selectedTool, params };
  const approval = await post('approval', { ...operation, planToken: plan.body.planToken });
  if (approval.status !== 201) throw new Error('INSPECTION_APPROVAL_FAILED');
  return { operation, planToken: plan.body.planToken, approvalToken: approval.body.approvalToken };
}
async function check(id: string, operation: () => Promise<boolean>) {
  const started = Date.now();
  try { rows.push({ id, passed: await operation(), durationMs: Date.now() - started }); }
  catch { rows.push({ id, passed: false, error: 'INSPECTION_OPERATION_FAILED', durationMs: Date.now() - started }); }
}
try {
  process.chdir(fixtureRoot);
  const fixtures = [
    ['empty.txt', ''],
    ['whitespace.txt', '  \n\t'],
    ['japanese.txt', '商品A 1200円×3、商品B 800円×2。合計5200円。\nFINAL_SENTINEL'],
    ['long.txt', 'あ'.repeat(12001) + '\nFINAL_SENTINEL'],
    ['source.txt', 'undefined\n```js\nfunction incomplete(){\n```\nFINAL_SENTINEL'],
    ['boundary.txt', 'x'.repeat(120000 - 'FINAL_SENTINEL!'.length) + 'FINAL_SENTINEL!'],
  ] as const;
  for (const [name, content] of fixtures) await writeFile(path.join(fixtureRoot, name), content);
  await check('separated-auth-status', async () => {
    const status = await request(app).get('/api/agent/v3/status');
    return status.status === 200 && status.body.ready === true && status.body.credentialSeparationConfigured === true && status.body.taskQualityQualification === 'not-measured';
  });
  for (const [name, expected] of fixtures) await check('read-exact-' + name, async () => {
    const prepared = await prepare('Read this source file.', { path: name });
    const result = await post('execute', { ...prepared.operation, approvalToken: prepared.approvalToken });
    const actual = typeof result.body.artifact === 'string' ? result.body.artifact : '';
    // Persist actual bytes, including incorrect outputs, for independent inspection.
    await save('actual-' + name, actual);
    await save('expected-' + name, expected);
    return result.status === 200 && result.body.status === 'completed' && hash(actual) === hash(expected) && Buffer.byteLength(actual) === Buffer.byteLength(expected);
  });
  await check('oversized-read-rejected', async () => {
    await writeFile(path.join(fixtureRoot, 'oversized.txt'), 'x'.repeat(120001));
    const p = await prepare('Read this source file.', { path: 'oversized.txt' });
    const result = await post('execute', { ...p.operation, approvalToken: p.approvalToken });
    return result.status === 422 && result.body.artifact === undefined && result.body.status !== 'completed';
  });
  await check('authentication-required', async () => {
    const p = await prepare('Read this source file.', { path: 'japanese.txt' });
    const result = await post('execute', { ...p.operation, approvalToken: p.approvalToken }, false);
    return result.status === 401;
  });
  await check('tampered-parameters-rejected', async () => {
    const p = await prepare('Read this source file.', { path: 'japanese.txt' });
    const result = await post('execute', { ...p.operation, params: { path: 'source.txt' }, approvalToken: p.approvalToken });
    return result.status === 403;
  });
  await check('invalid-approval-rejected', async () => {
    const p = await prepare('Read this source file.', { path: 'japanese.txt' });
    return (await post('execute', { ...p.operation, approvalToken: 'invalid' })).status === 403;
  });
  await check('replay-rejected', async () => {
    const p = await prepare('Read this source file.', { path: 'japanese.txt' });
    const body = { ...p.operation, approvalToken: p.approvalToken };
    return (await post('execute', body)).status === 200 && (await post('execute', body)).status === 409;
  });
  await check('cancel-prevents-execution', async () => {
    const p = await prepare('Read this source file.', { path: 'japanese.txt' });
    const cancel = await post('cancel', { runId: p.operation.runId, planToken: p.planToken });
    return cancel.status === 200 && (await post('execute', { ...p.operation, approvalToken: p.approvalToken })).status === 409;
  });
  for (const [id, goal, params] of [
    ['code-generation-unavailable', 'Repair this code.', { code: 'function f(){' }],
    ['document-generation-unavailable', 'Create a sales report.', { content: '売上を集計して提案してください。' }],
  ] as const) await check(id, async () => {
    const p = await prepare(goal, params);
    const result = await post('execute', { ...p.operation, approvalToken: p.approvalToken });
    return result.status === 422 && result.body.status !== 'completed' && result.body.artifact === undefined;
  });
} finally {
  process.chdir(originalCwd);
  await rm(fixtureRoot, { recursive: true, force: true });
}
const passed = rows.filter(row => row.passed === true).length;
const report = {
  schema: 'origin.agent-quality-inspection.v1', candidateSha: sha,
  inspectionScope: 'visible-local-http-regression-with-real-file-artifacts',
  submissionPrepared: true, regressionPassed: passed === rows.length,
  fullAgentQualificationReady: false, productionVerified: false,
  attempted: rows.length, passed, cases: rows,
  blockers: ['CODE_GENERATION_BACKEND_UNAVAILABLE', 'DOCUMENT_GENERATION_BACKEND_UNAVAILABLE', 'LIVE_RESEARCH_NOT_INCLUDED', 'SEMANTIC_GENERATIVE_EVALUATOR_NOT_IMPLEMENTED', 'REMOTE_CI_NOT_VERIFIED'],
  limits: ['No external inference or network request; ephemeral local credentials only.', 'Unavailable-generation rejection cases measure truthful failure, not generation success.', 'Fixtures are visible internal tasks, not sealed final evaluation.', 'In-memory replay store is local-only; production persistence is not assessed.'],
};
await save('inspection.json', JSON.stringify(report, null, 2) + '\n');
await save('README.md', '# ORIGIN Agent inspection packet\n\nCandidate: `' + sha + '`\n\n' + passed + '/' + rows.length + ' local regression checks passed. This is not full-agent quality qualification.\n\nActual and expected UTF-8 artifacts are included for byte comparison. `manifest.json` records SHA-256 and byte sizes. `inspection.json` includes every result and unresolved blocker.\n\nReproduce from the exact candidate with installed locked dependencies:\n\n```sh\nnode --import tsx scripts/prepare-agent-quality-inspection.ts /absolute/new/output-directory\n```\n\nThe output directory must not exist. The runner uses temporary fixture files, never resets the working checkout, makes no external inference calls, and does not save credentials or approval tokens.\n');
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ candidateSha: sha, files }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ candidateSha: sha, output, attempted: rows.length, passed, fullAgentQualificationReady: false }) + '\n');
if (passed !== rows.length) process.exitCode = 1;
