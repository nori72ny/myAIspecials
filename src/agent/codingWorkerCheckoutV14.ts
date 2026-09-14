import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const EXCLUDED_ROOT_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'test-results']);
// Reviewed public template with an empty provider credential. A changed template
// requires a new review; never copy arbitrary .env.example contents or symlinks.
const PUBLIC_TEMPLATE_SHA256 = 'ad1aa998042cd8deffe4b7325c6cd54d09965b8979eae227bab58bda2a7b81dd';

export async function copyTrustedCodingCheckoutV14(source: string, destination: string): Promise<void> {
  const templatePath = path.join(source, '.env.example');
  // Check and read the same descriptor. O_NOFOLLOW rejects a symlink swapped
  // into the path before open; the bounded read cannot ingest a growing file.
  const handle = await fs.open(templatePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(() => { throw new Error('CODING_WORKER_TEMPLATE_BLOCKED'); });
  let template: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192) throw new Error('CODING_WORKER_TEMPLATE_BLOCKED');
    const buffer = Buffer.alloc(8193);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 8192) throw new Error('CODING_WORKER_TEMPLATE_BLOCKED');
    template = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
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
