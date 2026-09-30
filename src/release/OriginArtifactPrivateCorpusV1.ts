import { createHash } from 'node:crypto';

import {
  ARTIFACT_CHALLENGE_TAGS_V1,
  ARTIFACT_FAMILIES_V1,
  type ArtifactBenchmarkCaseV1,
  type ArtifactChallengeTagV1,
  type ArtifactFamilyV1,
} from './OriginArtifactBlindBenchmarkV1.js';

export const ORIGIN_ARTIFACT_PRIVATE_CORPUS_SCHEMA_V1 =
  'origin.artifact-private-corpus.v1' as const;

export const ARTIFACT_PRIVATE_TECHNICAL_REQUIREMENTS_V1 = [
  'required-content',
  'structured-headings',
  'table-structure',
  'multi-slide',
  'responsive-layout',
  'offline-runtime',
  'editable-source',
  'multi-section',
] as const;

export type ArtifactPrivateTechnicalRequirementV1 =
  (typeof ARTIFACT_PRIVATE_TECHNICAL_REQUIREMENTS_V1)[number];

export type ArtifactPrivateTaskV1 = {
  caseId: string;
  family: ArtifactFamilyV1;
  challengeTags: readonly ArtifactChallengeTagV1[];
  expectedFormat: ArtifactBenchmarkCaseV1['expectedFormat'];
  prompt: string;
  promptSha256: string;
  requiredContent: readonly string[];
  technicalRequirements: readonly ArtifactPrivateTechnicalRequirementV1[];
  taskDigest: string;
};

export type OriginArtifactPrivateCorpusV1 = {
  schema: typeof ORIGIN_ARTIFACT_PRIVATE_CORPUS_SCHEMA_V1;
  corpusId: string;
  candidateSha: string;
  executionBudgetMs: number;
  tasks: readonly ArtifactPrivateTaskV1[];
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

export function sha256ArtifactPrivateTextV1(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digestArtifactPrivateTaskV1(
  task: Omit<ArtifactPrivateTaskV1, 'taskDigest'>,
): string {
  return createHash('sha256')
    .update(stable({
      caseId: task.caseId,
      family: task.family,
      challengeTags: [...task.challengeTags],
      expectedFormat: task.expectedFormat,
      prompt: task.prompt,
      promptSha256: task.promptSha256,
      requiredContent: [...task.requiredContent],
      technicalRequirements: [...task.technicalRequirements],
    }), 'utf8')
    .digest('hex');
}

function formatAllowed(family: ArtifactFamilyV1, format: ArtifactBenchmarkCaseV1['expectedFormat']): boolean {
  if (family === 'docx-business-document') return format === 'docx';
  if (family === 'xlsx-analysis') return format === 'xlsx';
  if (family === 'pptx-presentation') return format === 'pptx';
  if (family === 'pdf-report') return format === 'pdf';
  if (family === 'web-landing-page' || family === 'web-interactive-app') return format === 'html-zip';
  if (family === 'data-report') return ['csv', 'markdown', 'xlsx'].includes(format);
  if (family === 'revision-editability') return ['docx', 'xlsx', 'pptx', 'html-zip', 'csv', 'markdown'].includes(format);
  return false;
}

function requiredTechnicalRequirements(task: ArtifactPrivateTaskV1): readonly ArtifactPrivateTechnicalRequirementV1[] {
  if (task.family === 'docx-business-document') return ['required-content', 'structured-headings', 'editable-source'];
  if (task.family === 'xlsx-analysis') return ['required-content', 'table-structure', 'editable-source'];
  if (task.family === 'pptx-presentation') return ['required-content', 'multi-slide', 'editable-source'];
  if (task.family === 'pdf-report') return ['required-content', 'multi-section'];
  if (task.family === 'web-landing-page') return ['required-content', 'responsive-layout', 'offline-runtime', 'editable-source'];
  if (task.family === 'web-interactive-app') return ['required-content', 'responsive-layout', 'offline-runtime', 'editable-source'];
  if (task.family === 'data-report') return ['required-content'];
  return ['required-content', 'editable-source'];
}

export function validateArtifactPrivateCorpusV1(
  corpus: OriginArtifactPrivateCorpusV1,
): readonly string[] {
  const blockers: string[] = [];
  if (corpus?.schema !== ORIGIN_ARTIFACT_PRIVATE_CORPUS_SCHEMA_V1) blockers.push('ARTIFACT_PRIVATE_CORPUS_SCHEMA_INVALID');
  if (!SAFE_ID.test(corpus?.corpusId ?? '')) blockers.push('ARTIFACT_PRIVATE_CORPUS_ID_INVALID');
  if (!SHA40.test(corpus?.candidateSha ?? '')) blockers.push('ARTIFACT_PRIVATE_CORPUS_CANDIDATE_SHA_INVALID');
  if (!Number.isInteger(corpus?.executionBudgetMs) || corpus.executionBudgetMs < 10_000 || corpus.executionBudgetMs > 10 * 60_000) {
    blockers.push('ARTIFACT_PRIVATE_CORPUS_EXECUTION_BUDGET_INVALID');
  }

  const tasks = Array.isArray(corpus?.tasks) ? corpus.tasks : [];
  if (tasks.length !== 16) blockers.push('ARTIFACT_PRIVATE_CORPUS_REQUIRES_16_TASKS');
  if (new Set(tasks.map((task) => task?.caseId)).size !== tasks.length) blockers.push('ARTIFACT_PRIVATE_CORPUS_CASE_IDS_DUPLICATE');

  for (const family of ARTIFACT_FAMILIES_V1) {
    if (tasks.filter((task) => task?.family === family).length !== 2) {
      blockers.push(`ARTIFACT_PRIVATE_CORPUS_FAMILY_COUNT_INVALID:${family}`);
    }
  }
  for (const tag of ARTIFACT_CHALLENGE_TAGS_V1) {
    if (tasks.filter((task) => task?.challengeTags?.includes(tag)).length < 2) {
      blockers.push(`ARTIFACT_PRIVATE_CORPUS_CHALLENGE_COVERAGE_LT_2:${tag}`);
    }
  }

  for (const task of tasks) {
    const prefix = typeof task?.caseId === 'string' && task.caseId ? task.caseId : 'unknown';
    if (!SAFE_ID.test(task?.caseId ?? '')) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_CASE_ID_INVALID`);
    if (!ARTIFACT_FAMILIES_V1.includes(task?.family)) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_FAMILY_INVALID`);
    if (!formatAllowed(task?.family, task?.expectedFormat)) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_FORMAT_INVALID`);
    if (
      !Array.isArray(task?.challengeTags)
      || task.challengeTags.length === 0
      || new Set(task.challengeTags).size !== task.challengeTags.length
      || task.challengeTags.some((tag) => !ARTIFACT_CHALLENGE_TAGS_V1.includes(tag))
    ) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_CHALLENGE_TAGS_INVALID`);
    if (typeof task?.prompt !== 'string' || !task.prompt.trim() || task.prompt.length > 8_000) {
      blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_PROMPT_INVALID`);
    }
    if (
      !SHA256.test(task?.promptSha256 ?? '')
      || sha256ArtifactPrivateTextV1(task?.prompt ?? '') !== task.promptSha256
    ) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_PROMPT_DIGEST_MISMATCH`);
    if (
      !Array.isArray(task?.requiredContent)
      || task.requiredContent.length < 1
      || task.requiredContent.length > 12
      || task.requiredContent.some((value) => typeof value !== 'string' || !value.trim() || value.length > 160)
    ) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_REQUIRED_CONTENT_INVALID`);
    if (
      !Array.isArray(task?.technicalRequirements)
      || task.technicalRequirements.some((value) => !ARTIFACT_PRIVATE_TECHNICAL_REQUIREMENTS_V1.includes(value))
      || new Set(task.technicalRequirements).size !== task.technicalRequirements.length
    ) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_TECHNICAL_REQUIREMENTS_INVALID`);
    for (const required of requiredTechnicalRequirements(task)) {
      if (!task.technicalRequirements.includes(required)) {
        blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_REQUIRED_TECHNICAL_MISSING:${required}`);
      }
    }
    const withoutDigest = { ...task } as ArtifactPrivateTaskV1;
    delete (withoutDigest as Partial<ArtifactPrivateTaskV1>).taskDigest;
    if (
      !SHA256.test(task?.taskDigest ?? '')
      || digestArtifactPrivateTaskV1(withoutDigest as Omit<ArtifactPrivateTaskV1, 'taskDigest'>) !== task.taskDigest
    ) blockers.push(`${prefix}:ARTIFACT_PRIVATE_TASK_DIGEST_MISMATCH`);
  }

  return Object.freeze([...new Set(blockers)]);
}
