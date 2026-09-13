import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHARED_CODING_PROVIDER_PATHS = [
  "src/legacy/originProviderClient*.ts",
  'src/legacy/zeroCostRoutingPolicy.ts',
  'src/lib/orchestration/OriginExecutionPolicy.ts',
  'src/lib/orchestration/OriginFreeModelCatalog.ts',
] as const;

function readWorkflow(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('V1.4 workflow coverage', () => {
  it.each([
    '.github/workflows/coding-session-sandbox.yml',
    '.github/workflows/coding-production-smoke-v14.yml',
  ])('keeps shared provider/model dependencies inside %s path gates', (workflowPath) => {
    const workflow = readWorkflow(workflowPath);

    for (const path of SHARED_CODING_PROVIDER_PATHS) {
      expect(workflow).toContain(`- '${path}'`);
    }
  });
});
