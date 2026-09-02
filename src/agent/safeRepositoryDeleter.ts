import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { assertReadableAgentPath } from './safeFilePolicy.js';

export async function deleteRepositoryFile(root: string, requestedPath: string): Promise<void> {
  assertReadableAgentPath(requestedPath);
  const relative = requestedPath.replaceAll('\\', '/');
  if (!relative || path.posix.isAbsolute(relative)) throw new Error('PATH_OUTSIDE_REPOSITORY');
  const rootReal = await fs.realpath(root);
  const segments = relative.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) throw new Error('NOT_A_FILE');
  if (process.platform !== 'linux') throw new Error('RACE_SAFE_DELETE_UNSUPPORTED');

  let directoryHandle = await fs.open(rootReal, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    for (const segment of segments) {
      const childPath = path.join(`/proc/self/fd/${directoryHandle.fd}`, segment);
      const nextHandle = await fs.open(childPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      try {
        await directoryHandle.close();
        directoryHandle = nextHandle;
      } catch (error) {
        await nextHandle.close().catch(() => undefined);
        throw error;
      }
    }
    const target = path.join(`/proc/self/fd/${directoryHandle.fd}`, fileName);
    const stat = await fs.lstat(target);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('NOT_A_FILE');
    await fs.unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    await directoryHandle.close().catch(() => undefined);
  }
}
