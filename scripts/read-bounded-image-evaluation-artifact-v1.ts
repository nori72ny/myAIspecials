import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * Consume evaluator-controlled downloaded evidence from one opened regular-file
 * descriptor. This avoids the lstat(path) -> readFile(path) TOCTOU/symlink race.
 *
 * Never trust a path after checking it: the byte cap, file type, size and
 * mutation consistency checks all run on the SAME O_NOFOLLOW file handle.
 */
export async function readBoundedImageEvaluationArtifactV1(
  filename: string,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
    throw new Error('IMAGE_EVAL_ARTIFACT_LIMIT_INVALID');
  }
  // O_NONBLOCK stops a substituted FIFO from hanging during open. No symlinks.
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.size < 1n || initial.size > BigInt(maxBytes)) {
      throw new Error('IMAGE_EVAL_ARTIFACT_SIZE_OR_TYPE_INVALID');
    }

    const chunks: Buffer[] = [];
    let position = 0;
    while (position <= maxBytes) {
      const maxChunk = Math.min(64 * 1024, maxBytes + 1 - position);
      const chunk = Buffer.allocUnsafe(maxChunk);
      const { bytesRead } = await handle.read(chunk, 0, maxChunk, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      if (position > maxBytes) throw new Error('IMAGE_EVAL_ARTIFACT_BYTES_EXCEEDED');
      chunks.push(chunk.subarray(0, bytesRead));
    }

    const final = await handle.stat({ bigint: true });
    if (BigInt(position) !== initial.size
      || final.size !== initial.size
      || final.dev !== initial.dev
      || final.ino !== initial.ino
      || final.mtimeNs !== initial.mtimeNs
      || final.ctimeNs !== initial.ctimeNs) {
      throw new Error('IMAGE_EVAL_ARTIFACT_CHANGED_DURING_READ');
    }
    return Buffer.concat(chunks, position);
  } finally {
    await handle.close();
  }
}
