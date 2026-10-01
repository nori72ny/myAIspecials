import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2,
  digestGeneralAgentPermissionProfileV1,
  validateGeneralAgentPrivateCorpusV2,
  type GeneralAgentPrivateCorpusV2,
} from '../src/agent/privateGeneralAgentCorpusV2.js';

const MAX_CORPUS_B64 = 4_000_000;
const MAX_CORPUS_BYTES = 4_000_000;
const SHA40 = /^[a-f0-9]{40}$/;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GENERAL_AGENT_PRIVATE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(code: string): never {
  throw new Error(code);
}

function main(): void {
  const candidateSha = requiredEnv('ORIGIN_GENERAL_AGENT_CANDIDATE_SHA').toLowerCase();
  const expectedCorpusId = requiredEnv('ORIGIN_GENERAL_AGENT_CORPUS_ID');
  const encoded = requiredEnv('ORIGIN_GENERAL_AGENT_PRIVATE_CORPUS_GZIP_B64');

  if (!SHA40.test(candidateSha)) fail('GENERAL_AGENT_PRIVATE_CANDIDATE_SHA_INVALID');
  if (encoded.length > MAX_CORPUS_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    fail('GENERAL_AGENT_PRIVATE_CORPUS_ENCODING_INVALID');
  }

  let raw: Buffer;
  let corpus: GeneralAgentPrivateCorpusV2;
  try {
    raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_CORPUS_BYTES });
    corpus = JSON.parse(raw.toString('utf8')) as GeneralAgentPrivateCorpusV2;
  } catch {
    fail('GENERAL_AGENT_PRIVATE_CORPUS_PARSE_FAILED');
  }

  if (corpus.version !== GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2) {
    fail('GENERAL_AGENT_PRIVATE_CORPUS_VERSION_INVALID');
  }
  if (corpus.corpusId !== expectedCorpusId) fail('GENERAL_AGENT_PRIVATE_CORPUS_ID_MISMATCH');
  if (corpus.candidateSha.toLowerCase() !== candidateSha) fail('GENERAL_AGENT_PRIVATE_CORPUS_SHA_MISMATCH');

  const blockers = validateGeneralAgentPrivateCorpusV2(corpus);
  if (blockers.length) fail('GENERAL_AGENT_PRIVATE_CORPUS_VALIDATION_FAILED');
  if (corpus.permissionProfileDigest !== digestGeneralAgentPermissionProfileV1()) {
    fail('GENERAL_AGENT_PRIVATE_PERMISSION_PROFILE_MISMATCH');
  }

  process.stdout.write(JSON.stringify({
    schemaVersion: 'origin.general-agent-private-corpus-metadata.v1',
    corpusId: corpus.corpusId,
    corpusDigest: sha256(raw),
    candidateSha,
    taskCount: corpus.tasks.length,
    permissionProfileDigest: corpus.permissionProfileDigest,
  }) + '\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error && /^[A-Z0-9_:-]{3,180}$/.test(error.message)
    ? error.message
    : 'GENERAL_AGENT_PRIVATE_CORPUS_INSPECTION_FAILED';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
}
