import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execute = promisify(spawn as never);
const sha = 'a'.repeat(40);

function suite(status: 'SOLVED' | 'NOT_MEASURED' = 'SOLVED') {
  const task = (id: string, family: string) => ({
    id,
    candidateSha: sha,
    family,
    status,
    verifiedTerminal: status === 'SOLVED',
    falseCompletionClaims: 0,
    p0Defects: 0,
    p1Defects: 0,
    securityPassed: true,
    costUsd: 0,
    paidFallbackUsed: false,
    elapsedMs: 1000,
    timeBudgetMs: 60000,
  });
  return {
    version: 'origin.agent-frontier-task-gate.v3',
    candidateSha: sha,
    tasks: [
      ...Array.from({ length: 12 }, (_, i) => task(`coding-${i + 1}`, 'coding-repository')),
      ...Array.from({ length: 8 }, (_, i) => task(`agent-${i + 1}`, 'agent-multi-step')),
      ...Array.from({ length: 4 }, (_, i) => task(`artifact-${i + 1}`, 'artifact-deliverable')),
    ],
  };
}

async function run(filePath: string, outputPath?: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/qualify-agent-frontier-v3.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ORIGIN_AGENT_FRONTIER_EVIDENCE_PATH: filePath,
        ORIGIN_AGENT_FRONTIER_CANDIDATE_SHA: sha,
        ...(outputPath ? { ORIGIN_AGENT_FRONTIER_QUALIFICATION_OUTPUT_PATH: outputPath } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('qualify-agent-frontier-v3 CLI', () => {
  it('qualifies an exact-SHA fully solved 24-task evidence file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'origin-frontier-'));
    try {
      const input = path.join(dir, 'evidence.json');
      const output = path.join(dir, 'qualification.json');
      await writeFile(input, JSON.stringify(suite()), { mode: 0o600 });
      const result = await run(input, output);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ passed: true, measured: 24, solved: 24 });
      expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ passed: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns a distinct non-pass exit for valid but NOT_MEASURED evidence', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'origin-frontier-'));
    try {
      const input = path.join(dir, 'evidence.json');
      const value = suite();
      value.tasks[0].status = 'NOT_MEASURED';
      value.tasks[0].verifiedTerminal = false;
      await writeFile(input, JSON.stringify(value), { mode: 0o600 });
      const result = await run(input);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout).passed).toBe(false);
      expect(result.stderr).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown task fields instead of silently trusting them', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'origin-frontier-'));
    try {
      const input = path.join(dir, 'evidence.json');
      const value = suite() as ReturnType<typeof suite> & { tasks: Array<Record<string, unknown>> };
      value.tasks[0].pretendVerified = true;
      await writeFile(input, JSON.stringify(value), { mode: 0o600 });
      const result = await run(input);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('AGENT_FRONTIER_EVIDENCE_TASK_SCHEMA_INVALID');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked evidence file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'origin-frontier-'));
    try {
      const real = path.join(dir, 'real.json');
      const link = path.join(dir, 'link.json');
      await writeFile(real, JSON.stringify(suite()), { mode: 0o600 });
      await symlink(real, link);
      const result = await run(link);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('AGENT_FRONTIER_EVIDENCE_FILE_INVALID');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects evidence bound to another candidate SHA', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'origin-frontier-'));
    try {
      const input = path.join(dir, 'evidence.json');
      const value = suite();
      value.candidateSha = 'b'.repeat(40);
      for (const task of value.tasks) task.candidateSha = value.candidateSha;
      await writeFile(input, JSON.stringify(value), { mode: 0o600 });
      const result = await run(input);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('AGENT_FRONTIER_EVIDENCE_EXACT_SHA_MISMATCH');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
