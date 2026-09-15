import { gunzipSync } from 'node:zlib';
import {
  HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
  validateHeldOutPrivateTaskPacketV14,
  type HeldOutPrivateTaskPacketV14,
} from './heldOutCodingTrustedRunnerV14.js';

export const HELD_OUT_PRIVATE_CORPUS_VERSION = 'origin-held-out-private-corpus-v1' as const;
export const HELD_OUT_PRIVATE_CORPUS_MAX_TASKS = 16;
export const HELD_OUT_PRIVATE_CORPUS_MAX_COMPRESSED_BYTES = 36 * 1024;
export const HELD_OUT_PRIVATE_CORPUS_MAX_JSON_BYTES = 512 * 1024;

export type HeldOutPrivateCorpusV14 = {
  version: typeof HELD_OUT_PRIVATE_CORPUS_VERSION;
  tasks: HeldOutPrivateTaskPacketV14[];
};

function assertTaskId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) throw new Error('HELD_OUT_PRIVATE_TASK_ID_INVALID');
}

function decodeStrictBase64(value: string): Buffer {
  if (!value || value.length > 64 * 1024 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('HELD_OUT_PRIVATE_CORPUS_ENCODING_INVALID');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length > HELD_OUT_PRIVATE_CORPUS_MAX_COMPRESSED_BYTES) throw new Error('HELD_OUT_PRIVATE_CORPUS_COMPRESSED_LIMIT');
  return decoded;
}

export function validateHeldOutPrivateCorpusV14(corpus: HeldOutPrivateCorpusV14): void {
  if (!corpus || typeof corpus !== 'object' || corpus.version !== HELD_OUT_PRIVATE_CORPUS_VERSION) {
    throw new Error('HELD_OUT_PRIVATE_CORPUS_INVALID');
  }
  if (!Array.isArray(corpus.tasks) || corpus.tasks.length < 1 || corpus.tasks.length > HELD_OUT_PRIVATE_CORPUS_MAX_TASKS) {
    throw new Error('HELD_OUT_PRIVATE_CORPUS_TASKS_INVALID');
  }
  const ids = new Set<string>();
  for (const task of corpus.tasks) {
    validateHeldOutPrivateTaskPacketV14(task);
    if (task.version !== HELD_OUT_PRIVATE_TASK_PACKET_VERSION) throw new Error('HELD_OUT_PRIVATE_PACKET_INVALID');
    if (ids.has(task.id)) throw new Error('HELD_OUT_PRIVATE_CORPUS_TASK_DUPLICATE');
    ids.add(task.id);
  }
}

export function parseHeldOutPrivateCorpusGzipB64V14(encoded: string): HeldOutPrivateCorpusV14 {
  const compressed = decodeStrictBase64(encoded);
  let json: Buffer;
  try {
    json = gunzipSync(compressed, { maxOutputLength: HELD_OUT_PRIVATE_CORPUS_MAX_JSON_BYTES + 1 });
  } catch {
    throw new Error('HELD_OUT_PRIVATE_CORPUS_GZIP_INVALID');
  }
  if (json.length > HELD_OUT_PRIVATE_CORPUS_MAX_JSON_BYTES) throw new Error('HELD_OUT_PRIVATE_CORPUS_JSON_LIMIT');
  let corpus: HeldOutPrivateCorpusV14;
  try {
    corpus = JSON.parse(json.toString('utf8')) as HeldOutPrivateCorpusV14;
  } catch {
    throw new Error('HELD_OUT_PRIVATE_CORPUS_JSON_INVALID');
  }
  validateHeldOutPrivateCorpusV14(corpus);
  return corpus;
}

export function selectHeldOutPrivateTaskV14(corpus: HeldOutPrivateCorpusV14, taskId: string): HeldOutPrivateTaskPacketV14 {
  assertTaskId(taskId);
  validateHeldOutPrivateCorpusV14(corpus);
  const task = corpus.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error('HELD_OUT_PRIVATE_TASK_NOT_FOUND');
  return task;
}

export function selectHeldOutPrivateTaskFromGzipB64V14(encoded: string, taskId: string): HeldOutPrivateTaskPacketV14 {
  return selectHeldOutPrivateTaskV14(parseHeldOutPrivateCorpusGzipB64V14(encoded), taskId);
}
