// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyTrustedCodingCheckoutV14 } from './codingWorkerCheckoutV14.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'origin-checkout-test-'));
  roots.push(root);
  return root;
}

describe('credential-free worker checkout', () => {
  it('preserves the reviewed empty template while excluding real environment files', async () => {
    const source = await fixture();
    const target = await fixture();
    const template = await readFile('.env.example');
    await writeFile(path.join(source, '.env.example'), template);
    await writeFile(path.join(source, '.env'), 'PRIVATE_FIXTURE=must-not-copy');
    await writeFile(path.join(source, '.env.production'), 'PRIVATE_FIXTURE=must-not-copy');
    await writeFile(path.join(source, 'public.txt'), 'public');
    await copyTrustedCodingCheckoutV14(source, target);
    expect(await readFile(path.join(target, '.env.example'))).toEqual(template);
    expect(await readFile(path.join(target, 'public.txt'), 'utf8')).toBe('public');
    await expect(access(path.join(target, '.env'))).rejects.toThrow();
    await expect(access(path.join(target, '.env.production'))).rejects.toThrow();
  });

  it('rejects changed or symlinked templates before copying', async () => {
    const source = await fixture();
    const target = await fixture();
    await writeFile(path.join(source, '.env.example'), 'OPENROUTER_API_KEY="private-fixture"');
    await expect(copyTrustedCodingCheckoutV14(source, target)).rejects.toThrow('CODING_WORKER_TEMPLATE_BLOCKED');
    await expect(access(path.join(target, '.env.example'))).rejects.toThrow();
    await rm(path.join(source, '.env.example'));
    await symlink(path.resolve('.env.example'), path.join(source, '.env.example'));
    await expect(copyTrustedCodingCheckoutV14(source, target)).rejects.toThrow('CODING_WORKER_TEMPLATE_BLOCKED');
  });
});
