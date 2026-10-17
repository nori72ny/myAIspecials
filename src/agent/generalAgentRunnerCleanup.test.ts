// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const runner = path.resolve('scripts/run-general-agent-private-v2.ts');
const loader = path.resolve('node_modules/tsx/dist/loader.mjs');

describe('private evaluator refuses cleanup before validating a disposable checkout', () => {
  it.each(['no-opt-in', 'invalid-corpus'])('preserves user files without invoking Git on %s', mode => {
    const root = mkdtempSync(path.join(tmpdir(), 'origin-agent-cleanup-test-'));
    try {
      // Preflight failures must not reach any Git command, even in a minimal worker.
      const bin = path.join(root, 'bin');
      const gitCalled = path.join(root, 'git-called');
      mkdirSync(bin);
      writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(gitCalled)}, 'called'); process.exit(99);\n`, { mode: 0o755 });
      writeFileSync(path.join(root, 'tracked.txt'), 'OWNER EDIT');
      writeFileSync(path.join(root, 'untracked.txt'), 'OWNER NEW FILE');
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
      delete env.ORIGIN_GENERAL_AGENT_DISPOSABLE_CHECKOUT;
      if (mode === 'invalid-corpus') {
        env.ORIGIN_GENERAL_AGENT_DISPOSABLE_CHECKOUT = 'true';
        env.ORIGIN_GENERAL_AGENT_CANDIDATE_SHA = 'a'.repeat(40);
        env.ORIGIN_GENERAL_AGENT_CORPUS_ID = 'test-corpus';
        env.ORIGIN_GENERAL_AGENT_PRIVATE_CORPUS_GZIP_B64 = gzipSync(Buffer.from('not json')).toString('base64');
      }
      const result = spawnSync(process.execPath, ['--import', loader, runner], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(existsSync(gitCalled)).toBe(false);
      expect(result.stderr).toContain(mode === 'no-opt-in' ? 'GENERAL_AGENT_DISPOSABLE_CHECKOUT_REQUIRED' : 'GENERAL_AGENT_PRIVATE_CORPUS_PARSE_FAILED');
      expect(readFileSync(path.join(root, 'tracked.txt'), 'utf8')).toBe('OWNER EDIT');
      expect(readFileSync(path.join(root, 'untracked.txt'), 'utf8')).toBe('OWNER NEW FILE');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20000);
});
