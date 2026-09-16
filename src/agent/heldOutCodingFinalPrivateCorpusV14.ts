import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  HELD_OUT_FINAL_MAX_TASKS_V14,
  HELD_OUT_FINAL_MIN_TASKS_V14,
  HELD_OUT_FINAL_QUALIFICATION_VERSION_V14,
  HELD_OUT_FINAL_REQUIRED_COVERAGE_KEYS_V14,
  qualifyHeldOutFinalCorpusV14,
  type HeldOutFinalCorpusV14,
  type HeldOutFinalCoverageKeyV14,
  type HeldOutFinalCoverageV14,
  type HeldOutFinalRunProvenanceV14,
} from './heldOutCodingFinalQualificationV14.js';
import {
  heldOutPrivateTaskDigestV14,
  publicHeldOutTaskFromPrivatePacketV14,
  validateHeldOutPrivateTaskPacketV14,
  type HeldOutPrivateTaskPacketV14,
} from './heldOutCodingTrustedRunnerV14.js';

export const HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14 = 'origin-held-out-final-private-corpus-v1' as const;
export const HELD_OUT_FINAL_PRIVATE_MAX_COMPRESSED_BYTES_V14 = 128 * 1024;
export const HELD_OUT_FINAL_PRIVATE_MAX_EXPANDED_BYTES_V14 = 1536 * 1024;

/**
 * Public identities of the engineering pilot already observed while hardening V1.4.
 * A sealed final corpus containing any of these task identities is ineligible.
 */
export const HELD_OUT_V14_OBSERVED_PILOT_CORPUS_DIGESTS = [
  '164fd7fb686b982f2ef9b8226388f5eb82038e03266ea84174daafeaba61e808',
] as const;

export const HELD_OUT_V14_OBSERVED_PILOT_TASK_DIGESTS = [
  'ae5e3d4076f151023c3069837f1ba5e6f7fbe9eac96ca22c8b8c1b04eb245df4',
  'e553c6eeeb98637f45580524421cb64d93ecdfa6a22ddf38892ab3ff23d6447e',
  '9c13c9cc4317549def7bb943d7ae8cbb51bc5fefcffa58c06d710354df9c8bf4',
  'c4098b0d22a1bfcd7b2b4a6a86aa13134e6abf08b6ede1a3429c2449a362c0c2',
] as const;

export type HeldOutFinalPrivateTaskV14 = {
  coverage: HeldOutFinalCoverageKeyV14[];
  packet: HeldOutPrivateTaskPacketV14;
};

export type HeldOutFinalPrivateCorpusV14 = {
  version: typeof HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14;
  qualification: typeof HELD_OUT_FINAL_QUALIFICATION_VERSION_V14;
  corpusId: string;
  tasks: HeldOutFinalPrivateTaskV14[];
};

export type HeldOutFinalPreparedCorpusV14 = {
  privateCorpus: HeldOutFinalPrivateCorpusV14;
  publicCorpus: HeldOutFinalCorpusV14;
  provenance: HeldOutFinalRunProvenanceV14;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function coverageKeys(value: unknown): value is HeldOutFinalCoverageKeyV14[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > HELD_OUT_FINAL_REQUIRED_COVERAGE_KEYS_V14.length) return false;
  if (value.length !== new Set(value).size) return false;
  return value.every(key => typeof key === 'string' && (HELD_OUT_FINAL_REQUIRED_COVERAGE_KEYS_V14 as readonly string[]).includes(key));
}

function coverageFromTasks(tasks: HeldOutFinalPrivateTaskV14[]): HeldOutFinalCoverageV14 {
  const seen = new Set(tasks.flatMap(task => task.coverage));
  return {
    navigationMultiFile: seen.has('navigationMultiFile'),
    featureWithNewFile: seen.has('featureWithNewFile'),
    regressionRecovery: seen.has('regressionRecovery'),
    buildOrTypecheckRepair: seen.has('buildOrTypecheckRepair'),
    securityPathBoundary: seen.has('securityPathBoundary'),
  };
}

function digestPrivateCorpus(corpus: HeldOutFinalPrivateCorpusV14): string {
  return createHash('sha256').update(canonical(corpus)).digest('hex');
}

export function validateHeldOutFinalPrivateCorpusV14(value: unknown): asserts value is HeldOutFinalPrivateCorpusV14 {
  if (!value || typeof value !== 'object') throw new Error('HELD_OUT_FINAL_PRIVATE_CORPUS_INVALID');
  const corpus = value as HeldOutFinalPrivateCorpusV14;
  if (corpus.version !== HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14) throw new Error('HELD_OUT_FINAL_PRIVATE_VERSION_INVALID');
  if (corpus.qualification !== HELD_OUT_FINAL_QUALIFICATION_VERSION_V14) throw new Error('HELD_OUT_FINAL_PRIVATE_QUALIFICATION_INVALID');
  if (!safeOpaqueId(corpus.corpusId)) throw new Error('HELD_OUT_FINAL_PRIVATE_ID_INVALID');
  if (!Array.isArray(corpus.tasks) || corpus.tasks.length < HELD_OUT_FINAL_MIN_TASKS_V14 || corpus.tasks.length > HELD_OUT_FINAL_MAX_TASKS_V14) {
    throw new Error('HELD_OUT_FINAL_PRIVATE_TASK_COUNT_INVALID');
  }

  const ids = new Set<string>();
  const digests = new Set<string>();
  for (const row of corpus.tasks) {
    if (!row || typeof row !== 'object' || !coverageKeys(row.coverage)) throw new Error('HELD_OUT_FINAL_PRIVATE_COVERAGE_INVALID');
    validateHeldOutPrivateTaskPacketV14(row.packet);
    if (ids.has(row.packet.id)) throw new Error('HELD_OUT_FINAL_PRIVATE_TASK_ID_DUPLICATE');
    ids.add(row.packet.id);
    const digest = heldOutPrivateTaskDigestV14(row.packet).toLowerCase();
    if (digests.has(digest)) throw new Error('HELD_OUT_FINAL_PRIVATE_TASK_DIGEST_DUPLICATE');
    digests.add(digest);
  }
}

export function publicHeldOutFinalCorpusFromPrivateV14(corpus: HeldOutFinalPrivateCorpusV14): HeldOutFinalCorpusV14 {
  validateHeldOutFinalPrivateCorpusV14(corpus);
  const tasks = corpus.tasks.map(row => publicHeldOutTaskFromPrivatePacketV14(row.packet));
  return {
    qualification: HELD_OUT_FINAL_QUALIFICATION_VERSION_V14,
    corpusId: corpus.corpusId,
    corpusDigest: digestPrivateCorpus(corpus),
    frozenBaseSha: tasks[0]?.baseSha ?? '',
    coverage: coverageFromTasks(corpus.tasks),
    tasks,
  };
}

export function finalHeldOutQualificationProvenanceV14(): HeldOutFinalRunProvenanceV14 {
  return {
    runOrdinal: 1,
    engineeringObservedBeforeRun: false,
    taskSpecificTuningAfterFreeze: false,
    priorObservedCorpusDigests: [...HELD_OUT_V14_OBSERVED_PILOT_CORPUS_DIGESTS],
    priorObservedTaskDigests: [...HELD_OUT_V14_OBSERVED_PILOT_TASK_DIGESTS],
  };
}

export function prepareHeldOutFinalPrivateCorpusV14(corpus: HeldOutFinalPrivateCorpusV14): HeldOutFinalPreparedCorpusV14 {
  const publicCorpus = publicHeldOutFinalCorpusFromPrivateV14(corpus);
  const provenance = finalHeldOutQualificationProvenanceV14();
  const qualification = qualifyHeldOutFinalCorpusV14(publicCorpus, provenance);
  if (!qualification.eligible) throw new Error(`HELD_OUT_FINAL_NOT_ELIGIBLE:${qualification.reasons.join(',')}`);
  return { privateCorpus: corpus, publicCorpus, provenance };
}

export function parseHeldOutFinalPrivateCorpusGzipBase64V14(encoded: string): HeldOutFinalPreparedCorpusV14 {
  if (typeof encoded !== 'string' || !encoded.trim() || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded.trim())) {
    throw new Error('HELD_OUT_FINAL_PRIVATE_CORPUS_ENCODING_INVALID');
  }
  const compressed = Buffer.from(encoded.trim(), 'base64');
  if (!compressed.length || compressed.length > HELD_OUT_FINAL_PRIVATE_MAX_COMPRESSED_BYTES_V14) {
    throw new Error('HELD_OUT_FINAL_PRIVATE_CORPUS_COMPRESSED_LIMIT');
  }
  let expanded: Buffer;
  try {
    expanded = gunzipSync(compressed, { maxOutputLength: HELD_OUT_FINAL_PRIVATE_MAX_EXPANDED_BYTES_V14 });
  } catch {
    throw new Error('HELD_OUT_FINAL_PRIVATE_CORPUS_GZIP_INVALID');
  }
  if (!expanded.length || expanded.length > HELD_OUT_FINAL_PRIVATE_MAX_EXPANDED_BYTES_V14) {
    throw new Error('HELD_OUT_FINAL_PRIVATE_CORPUS_EXPANDED_LIMIT');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(expanded.toString('utf8'));
  } catch {
    throw new Error('HELD_OUT_FINAL_PRIVATE_CORPUS_JSON_INVALID');
  }
  validateHeldOutFinalPrivateCorpusV14(parsed);
  return prepareHeldOutFinalPrivateCorpusV14(parsed);
}

export function finalPrivateTaskByIdV14(prepared: HeldOutFinalPreparedCorpusV14, taskId: string): HeldOutPrivateTaskPacketV14 {
  const match = prepared.privateCorpus.tasks.find(row => row.packet.id === taskId);
  if (!match) throw new Error('HELD_OUT_FINAL_TASK_NOT_FOUND');
  return match.packet;
}
