import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODING_CHECK_TIMEOUT_MS, CODING_WORKER_LEASE_SECONDS, CODING_WORKER_RECOVERY_WAIT_SECONDS } from './codingWorkerTimingV14.js';

const SHARED_CODING_RUNTIME_PATHS = [
  "src/legacy/originProviderClient*.ts",
  'src/legacy/zeroCostRoutingPolicy.ts',
  'src/lib/orchestration/OriginExecutionPolicy.ts',
  'src/lib/orchestration/OriginFreeModelCatalog.ts',
  'scripts/run-coding-job-worker-v14.ts',
  'src/agent/codingIsolatedVerificationV14.ts',
] as const;

function readWorkflow(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('V1.4 workflow coverage', () => {
  it.each([
    '.github/workflows/coding-session-sandbox.yml',
    '.github/workflows/coding-production-smoke-v14.yml',
  ])('keeps shared Coding runtime dependencies inside %s path gates', (workflowPath) => {
    const workflow = readWorkflow(workflowPath);

    for (const path of SHARED_CODING_RUNTIME_PATHS) {
      expect(workflow).toContain(`- '${path}'`);
    }
  });

  it('keeps Vite and Vitest caches writable without making dependencies mutable', () => {
    const verifier = readWorkflow('src/agent/codingIsolatedVerificationV14.ts');
    const viteConfig = readWorkflow('vite.config.ts');

    expect(verifier).toContain('type=bind,src=${path.join(dependencyRoot, "node_modules")},dst=/work/node_modules,readonly');
    expect(verifier).toContain('"ORIGIN_ISOLATED_VERIFY=true"');
    expect(verifier).toContain('vitest run --configLoader runner');
    expect(verifier).toContain('vite build --configLoader runner');
    expect(viteConfig).toContain("process.env.ORIGIN_ISOLATED_VERIFY === 'true' ? '/tmp/origin-vite-cache' : undefined");
  });

  it('bounds the hosted Vitest pool and keeps the job lease longer than one check', () => {
    const worker = readWorkflow('scripts/run-coding-job-worker-v14.ts');
    const verifier = readWorkflow('src/agent/codingIsolatedVerificationV14.ts');

    expect(CODING_WORKER_LEASE_SECONDS * 1000).toBeGreaterThan(CODING_CHECK_TIMEOUT_MS);
    expect(worker).toContain('CODING_WORKER_LEASE_SECONDS as WORKER_LEASE_SECONDS');
    expect(verifier).toContain('vitest run --configLoader runner --maxWorkers=2');
    expect(worker).toContain('leaseSeconds: WORKER_LEASE_SECONDS');
  });

  it('waits beyond a freshly renewed lease before hosted recovery', () => {
    const workflow = readWorkflow('.github/workflows/coding-job-worker-v14.yml');
    expect(CODING_WORKER_RECOVERY_WAIT_SECONDS).toBeGreaterThan(CODING_WORKER_LEASE_SECONDS);
    expect(workflow).toContain('import { CODING_WORKER_RECOVERY_WAIT_SECONDS }');
    expect(workflow).toContain('sleep "$recovery_wait"');
    expect(workflow).not.toContain('sleep 125');
  });
});
