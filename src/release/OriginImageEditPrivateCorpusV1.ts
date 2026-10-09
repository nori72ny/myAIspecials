import { createHash } from 'node:crypto';
import { readRasterDimensionsV15 } from '../creative/rasterImageProviderV15.js';

import { IMAGE_EDIT_FAMILIES_V1, type ImageEditFamilyV1 } from './OriginImageEditBlindBenchmarkV1';

export const ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_SCHEMA = 'origin.image-edit-private-corpus.v1' as const;

export type ImageEditPrivateTaskV1 = {
  caseId: string;
  family: ImageEditFamilyV1;
  instruction: string;
  instructionSha256: string;
  sourceImageDataUrl: string;
  sourceImageSha256: string;
  width: number;
  height: number;
  turnIndex: number;
};

export type OriginImageEditPrivateCorpusV1 = {
  schema: typeof ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_SCHEMA;
  corpusId: string;
  candidateSha: string;
  createdAt: string;
  expiresAt: string;
  executionBudgetMs: number;
  tasks: readonly ImageEditPrivateTaskV1[];
};

const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const REQUIRED_PER_FAMILY = 2;
const REQUIRED_TASKS = IMAGE_EDIT_FAMILIES_V1.length * REQUIRED_PER_FAMILY;
const MAX_REFERENCE_BYTES = 768 * 1024;
const MAX_DIMENSION_EXCLUSIVE = 512;
const MAX_INSTRUCTION_CHARS = 4_000;
const MAX_LIFETIME_MS = 31 * 24 * 60 * 60_000;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function validateImageEditPrivateCorpusV1(
  corpus: OriginImageEditPrivateCorpusV1,
  nowMs = Date.now(),
): string[] {
  const blockers: string[] = [];
  const createdAt = Date.parse(corpus.createdAt);
  const expiresAt = Date.parse(corpus.expiresAt);

  if (
    corpus.schema !== ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_SCHEMA
    || !corpus.corpusId?.trim()
    || !FULL_SHA.test(corpus.candidateSha)
    || !Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= createdAt
    || !Number.isInteger(corpus.executionBudgetMs)
    || corpus.executionBudgetMs < 1_000
    || corpus.executionBudgetMs > 300_000
    || !Array.isArray(corpus.tasks)
  ) return ['IMAGE_EDIT_PRIVATE_CORPUS_INVALID'];

  if (createdAt > nowMs + 5 * 60_000 || expiresAt < nowMs) blockers.push('IMAGE_EDIT_PRIVATE_CORPUS_STALE_OR_FUTURE');
  if (expiresAt - createdAt > MAX_LIFETIME_MS) blockers.push('IMAGE_EDIT_PRIVATE_CORPUS_LIFETIME_TOO_LONG');
  if (corpus.tasks.length !== REQUIRED_TASKS) blockers.push('IMAGE_EDIT_PRIVATE_CORPUS_REQUIRES_16_TASKS');

  const caseIds = new Set<string>();
  for (const family of IMAGE_EDIT_FAMILIES_V1) {
    if (corpus.tasks.filter((task) => task.family === family).length !== REQUIRED_PER_FAMILY) {
      blockers.push(`IMAGE_EDIT_PRIVATE_CORPUS_FAMILY_COUNT_INVALID:${family}`);
    }
  }

  for (const task of corpus.tasks) {
    if (!task.caseId?.trim() || caseIds.has(task.caseId)) blockers.push('IMAGE_EDIT_PRIVATE_CORPUS_CASE_IDS_INVALID');
    caseIds.add(task.caseId);
    if (!IMAGE_EDIT_FAMILIES_V1.includes(task.family)) blockers.push(`IMAGE_EDIT_PRIVATE_CORPUS_FAMILY_INVALID:${task.caseId}`);
    if (!task.instruction?.trim() || task.instruction.length > MAX_INSTRUCTION_CHARS || sha256(task.instruction) !== task.instructionSha256) {
      blockers.push(`IMAGE_EDIT_PRIVATE_CORPUS_INSTRUCTION_INVALID:${task.caseId}`);
    }
    const match = DATA_URL.exec(task.sourceImageDataUrl ?? '');
    if (!match) {
      blockers.push(`IMAGE_EDIT_PRIVATE_CORPUS_SOURCE_INVALID:${task.caseId}`);
    } else {
      const bytes = Buffer.from(match[2] ?? '', 'base64');
      const mime = match[1] as 'image/png' | 'image/jpeg' | 'image/webp';
      const signatureValid = mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
          : bytes.subarray(0, 4).toString('ascii') === 'RIFF'
            && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
      const dimensions = signatureValid ? readRasterDimensionsV15(bytes, mime) : null;
      if (bytes.length < 64 || bytes.length > MAX_REFERENCE_BYTES
        || !DIGEST.test(task.sourceImageSha256) || sha256(bytes) !== task.sourceImageSha256
        || !dimensions || dimensions.width < 1 || dimensions.height < 1
        || dimensions.width >= MAX_DIMENSION_EXCLUSIVE
        || dimensions.height >= MAX_DIMENSION_EXCLUSIVE) {
        blockers.push(`IMAGE_EDIT_PRIVATE_CORPUS_SOURCE_INVALID:${task.caseId}`);
      }
    }
    if (!Number.isInteger(task.width) || !Number.isInteger(task.height) || task.width < 256 || task.height < 256 || task.width >= MAX_DIMENSION_EXCLUSIVE || task.height >= MAX_DIMENSION_EXCLUSIVE) {
      blockers.push(`IMAGE_EDIT_PRIVATE_CORPUS_DIMENSIONS_INVALID:${task.caseId}`);
    }
    if (!Number.isInteger(task.turnIndex) || task.turnIndex < 1 || task.turnIndex > 8) blockers.push(`IMAGE_EDIT_PRIVATE_CORPUS_TURN_INVALID:${task.caseId}`);
  }

  return [...new Set(blockers)];
}
