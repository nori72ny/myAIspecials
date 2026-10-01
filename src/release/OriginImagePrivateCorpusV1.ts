import { createHash } from 'node:crypto';

import {
  IMAGE_CHALLENGE_TAGS_V15,
  IMAGE_FAMILIES_V15,
  type ImageChallengeTagV15,
  type ImageFamilyV15,
} from './OriginImageBlindBenchmarkV15.js';

export const ORIGIN_IMAGE_PRIVATE_CORPUS_SCHEMA_V1 =
  'origin.image-private-corpus.v1' as const;

export type ImagePrivateTaskV1 = {
  caseId: string;
  family: ImageFamilyV15;
  challengeTags: readonly ImageChallengeTagV15[];
  prompt: string;
  negativePrompt?: string;
  promptSha256: string;
  width: number;
  height: number;
  requiresText: boolean;
  taskDigest: string;
};

export type OriginImagePrivateCorpusV1 = {
  schema: typeof ORIGIN_IMAGE_PRIVATE_CORPUS_SCHEMA_V1;
  corpusId: string;
  candidateSha: string;
  executionBudgetMs: number;
  syntheticEvaluationOnly: true;
  tasks: readonly ImagePrivateTaskV1[];
};

const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

export function sha256ImagePrivateTextV1(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digestImagePrivateTaskV1(
  task: Omit<ImagePrivateTaskV1, 'taskDigest'>,
): string {
  return createHash('sha256')
    .update(stable({
      caseId: task.caseId,
      family: task.family,
      challengeTags: [...task.challengeTags],
      prompt: task.prompt,
      negativePrompt: task.negativePrompt ?? '',
      promptSha256: task.promptSha256,
      width: task.width,
      height: task.height,
      requiresText: task.requiresText,
    }), 'utf8')
    .digest('hex');
}

export function validateImagePrivateCorpusV1(
  corpus: OriginImagePrivateCorpusV1,
): readonly string[] {
  const blockers: string[] = [];
  if (corpus?.schema !== ORIGIN_IMAGE_PRIVATE_CORPUS_SCHEMA_V1) blockers.push('IMAGE_PRIVATE_CORPUS_SCHEMA_INVALID');
  if (!SAFE_ID.test(corpus?.corpusId ?? '')) blockers.push('IMAGE_PRIVATE_CORPUS_ID_INVALID');
  if (!SHA40.test(corpus?.candidateSha ?? '')) blockers.push('IMAGE_PRIVATE_CORPUS_CANDIDATE_SHA_INVALID');
  if (!Number.isInteger(corpus?.executionBudgetMs) || corpus.executionBudgetMs < 10_000 || corpus.executionBudgetMs > 300_000) {
    blockers.push('IMAGE_PRIVATE_CORPUS_EXECUTION_BUDGET_INVALID');
  }
  if (corpus?.syntheticEvaluationOnly !== true) blockers.push('IMAGE_PRIVATE_CORPUS_SYNTHETIC_ONLY_REQUIRED');

  const tasks = Array.isArray(corpus?.tasks) ? corpus.tasks : [];
  if (tasks.length !== 24) blockers.push('IMAGE_PRIVATE_CORPUS_REQUIRES_24_TASKS');
  if (new Set(tasks.map((task) => task?.caseId)).size !== tasks.length) blockers.push('IMAGE_PRIVATE_CORPUS_CASE_IDS_DUPLICATE');

  for (const family of IMAGE_FAMILIES_V15) {
    if (tasks.filter((task) => task?.family === family).length !== 3) {
      blockers.push(`IMAGE_PRIVATE_CORPUS_FAMILY_COUNT_INVALID:${family}`);
    }
  }
  for (const tag of IMAGE_CHALLENGE_TAGS_V15) {
    if (tasks.filter((task) => task?.challengeTags?.includes(tag)).length < 2) {
      blockers.push(`IMAGE_PRIVATE_CORPUS_CHALLENGE_COVERAGE_LT_2:${tag}`);
    }
  }

  for (const task of tasks) {
    const prefix = typeof task?.caseId === 'string' && task.caseId ? task.caseId : 'unknown';
    if (!SAFE_ID.test(task?.caseId ?? '')) blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_CASE_ID_INVALID`);
    if (!IMAGE_FAMILIES_V15.includes(task?.family)) blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_FAMILY_INVALID`);
    if (
      !Array.isArray(task?.challengeTags)
      || task.challengeTags.length < 1
      || new Set(task.challengeTags).size !== task.challengeTags.length
      || task.challengeTags.some((tag) => !IMAGE_CHALLENGE_TAGS_V15.includes(tag))
    ) blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_CHALLENGE_TAGS_INVALID`);
    if (typeof task?.prompt !== 'string' || !task.prompt.trim() || task.prompt.length > 2_048) {
      blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_PROMPT_INVALID`);
    }
    if (task?.negativePrompt !== undefined && (typeof task.negativePrompt !== 'string' || task.negativePrompt.length > 1_000)) {
      blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_NEGATIVE_PROMPT_INVALID`);
    }
    if (
      !SHA256.test(task?.promptSha256 ?? '')
      || sha256ImagePrivateTextV1(task?.prompt ?? '') !== task.promptSha256
    ) blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_PROMPT_DIGEST_MISMATCH`);
    if (
      !Number.isInteger(task?.width)
      || !Number.isInteger(task?.height)
      || task.width < 256
      || task.height < 256
      || task.width > 1536
      || task.height > 1536
    ) blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_DIMENSIONS_INVALID`);
    if (typeof task?.requiresText !== 'boolean') blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_REQUIRES_TEXT_INVALID`);
    if (task.requiresText && !task.challengeTags.includes('text')) {
      blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_TEXT_TAG_REQUIRED`);
    }
    const withoutDigest = { ...task } as ImagePrivateTaskV1;
    delete (withoutDigest as Partial<ImagePrivateTaskV1>).taskDigest;
    if (
      !SHA256.test(task?.taskDigest ?? '')
      || digestImagePrivateTaskV1(withoutDigest as Omit<ImagePrivateTaskV1, 'taskDigest'>) !== task.taskDigest
    ) blockers.push(`${prefix}:IMAGE_PRIVATE_TASK_DIGEST_MISMATCH`);
  }

  return Object.freeze([...new Set(blockers)]);
}
