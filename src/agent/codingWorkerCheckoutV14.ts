import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const EXCLUDED_ROOT_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'test-results']);
// Reviewed public template with an empty provider credential. A changed template
// requires a new review; never copy arbitrary .env.example contents or symlinks.
const PUBLIC_TEMPLATE_SHA256 = 'ad1aa998042cd8deffe4b7325c6cd54d09965b8979eae227bab58bda2a7b81dd';

export async function copyTrustedCodingCheckoutV14(source: string, destination: string): Promise<void> {
  const templatePath = path.join(source, '.env.example');
  const stat = await fs.lstat(templatePath);
  if (!stat.isFile() || stat.size > 8192) throw new Error('CODING_WORKER_TEMPLATE_BLOCKED');
  const template = await fs.readFile(templatePath);
  if (createHash('sha256').update(template).digest('hex') !== PUBLIC_TEMPLATE_SHA256) {
    throw new Error('CODING_WORKER_TEMPLATE_BLOCKED');
  }
  await fs.cp(source, destination, {
    recursive: true,
    dereference: false,
    filter: candidate => {
      const relative = path.relative(source, candidate);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return !EXCLUDED_ROOT_NAMES.has(first) && !/^\.env(?:\.|$)/i.test(first);
    },
  });
  // Write the already-validated bytes, not a second read of the source path.
  await fs.writeFile(path.join(destination, '.env.example'), template, { flag: 'wx' });
}
