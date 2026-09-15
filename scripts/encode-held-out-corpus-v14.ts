import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  HELD_OUT_PRIVATE_CORPUS_MAX_COMPRESSED_BYTES,
  validateHeldOutPrivateCorpusV14,
  type HeldOutPrivateCorpusV14,
} from '../src/agent/heldOutCodingPrivateCorpusV14.js';

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('HELD_OUT_CORPUS_INPUT_REQUIRED');
  const raw = await fs.readFile(inputPath);
  let corpus: HeldOutPrivateCorpusV14;
  try {
    corpus = JSON.parse(raw.toString('utf8')) as HeldOutPrivateCorpusV14;
  } catch {
    throw new Error('HELD_OUT_PRIVATE_CORPUS_JSON_INVALID');
  }
  validateHeldOutPrivateCorpusV14(corpus);
  const canonicalJson = Buffer.from(JSON.stringify(corpus), 'utf8');
  const compressed = gzipSync(canonicalJson, { level: 9 });
  if (compressed.length > HELD_OUT_PRIVATE_CORPUS_MAX_COMPRESSED_BYTES) {
    throw new Error('HELD_OUT_PRIVATE_CORPUS_COMPRESSED_LIMIT');
  }
  const encoded = compressed.toString('base64');
  const digest = createHash('sha256').update(canonicalJson).digest('hex');
  process.stdout.write(JSON.stringify({
    version: corpus.version,
    tasks: corpus.tasks.map(task => task.id),
    jsonBytes: canonicalJson.length,
    gzipBytes: compressed.length,
    base64Bytes: Buffer.byteLength(encoded, 'utf8'),
    corpusDigest: digest,
    secretValue: encoded,
  }, null, 2) + '\n');
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : 'HELD_OUT_CORPUS_ENCODER_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
