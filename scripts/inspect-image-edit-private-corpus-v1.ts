import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  validateImageEditPrivateCorpusV1,
  type OriginImageEditPrivateCorpusV1,
} from '../src/release/OriginImageEditPrivateCorpusV1.js';

const encoded = process.env.ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_GZIP_B64?.trim() ?? '';
if (!encoded || encoded.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
  throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_ENCODING_INVALID');
}

let raw: Buffer;
let corpus: OriginImageEditPrivateCorpusV1;
try {
  raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 6_000_000 });
  corpus = JSON.parse(raw.toString('utf8')) as OriginImageEditPrivateCorpusV1;
} catch {
  throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_PARSE_FAILED');
}

const blockers = validateImageEditPrivateCorpusV1(corpus);
if (blockers.length) throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_VALIDATION_FAILED');

process.stdout.write(JSON.stringify({
  schemaVersion: 'origin.image-edit-private-corpus-metadata.v1',
  corpusId: corpus.corpusId,
  corpusDigest: createHash('sha256').update(raw).digest('hex'),
  candidateSha: corpus.candidateSha.toLowerCase(),
  executionBudgetMs: corpus.executionBudgetMs,
  taskCount: corpus.tasks.length,
}) + '\n');
