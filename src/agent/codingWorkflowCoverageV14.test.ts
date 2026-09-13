import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHARED_CODING_RUNTIME_PATHS = [
  "src/legacy/originProviderClient*.ts",
  'src/legacy/zeroCostRoutingPolicy.ts',
  'src/lib/orchestration/OriginExecutionPolicy.ts',
  'src/lib/orchestration/OriginFreeModelCatalog.ts',
  'scripts/run-coding-job-worker-v14.ts',
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
    const worker = readWorkflow('scripts/run-coding-job-worker-v14.ts');
    const viteConfig = readWorkflow('vite.config.ts');

    expect(worker).toContain("type=bind,src=${path.join(dependencyRoot, 'node_modules')},dst=/work/node_modules,readonly");
    expect(worker).toContain("'ORIGIN_ISOLATED_VERIFY=true'");
    expect(worker).toContain('vitest run --configLoader runner');
    expect(worker).toContain('vite build --configLoader runner');
    expect(viteConfig).toContain("process.env.ORIGIN_ISOLATED_VERIFY === 'true' ? '/tmp/origin-vite-cache' : undefined");
  });
});
