import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { loadNycConfig } = require('@istanbuljs/load-nyc-config');

it('loads inherited YAML coverage configuration after removing the vulnerable legacy parser dependency', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'origin-nyc-config-'));
  try {
    await writeFile(join(cwd, 'package.json'), '{}');
    await writeFile(join(cwd, 'base.yml'), 'include:\n  - src/**/*.ts\ncheck-coverage: true\n');
    await writeFile(join(cwd, '.nycrc.yaml'), 'extends: ./base.yml\nexclude:\n  - tests/**\nbranches: 80\n');
    const config = await loadNycConfig({ cwd });
    expect(config).toMatchObject({ include: ['src/**/*.ts'], exclude: ['tests/**'], checkCoverage: true, branches: 80 });
    await writeFile(join(cwd, '.nycrc.yaml'), 'branches: [unterminated');
    await expect(loadNycConfig({ cwd })).rejects.toThrow();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
