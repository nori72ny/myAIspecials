import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  validateArtifactPrivateCorpusV1,
  type OriginArtifactPrivateCorpusV1,
} from '../src/release/OriginArtifactPrivateCorpusV1.js';

const encoded = process.env.ORIGIN_ARTIFACT_PRIVATE_CORPUS_GZIP_B64?.trim() ?? '';
if (!encoded || encoded.length > 4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
  throw new Error('ARTIFACT_PRIVATE_CORPUS_ENCODING_INVALID');
}

let raw: Buffer;
let corpus: OriginArtifactPrivateCorpusV1;
try {
  raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 4_000_000 });
  corpus = JSON.parse(raw.toString('utf8')) as OriginArtifactPrivateCorpusV1;
} catch {
  throw new Error('ARTIFACT_PRIVATE_CORPUS_PARSE_FAILED');
}

const blockers = validateArtifactPrivateCorpusV1(corpus);
if (blockers.length > 0) throw new Error('ARTIFACT_PRIVATE_CORPUS_VALIDATION_FAILED');

process.stdout.write(JSON.stringify({
  schemaVersion: 'origin.artifact-private-corpus-metadata.v1',
  corpusId: corpus.corpusId,
  corpusDigest: createHash('sha256').update(raw).digest('hex'),
  candidateSha: corpus.candidateSha.toLowerCase(),
  executionBudgetMs: corpus.executionBudgetMs,
  taskCount: corpus.tasks.length,
}) + '\n');
