import { createHash } from 'node:crypto';

import {
  GENERAL_AGENT_CAPABILITIES_V2,
  GENERAL_AGENT_HELD_OUT_VERSION_V2,
  validateGeneralAgentTaskV2,
  type GeneralAgentCapabilityV2,
  type GeneralAgentExpectedTerminalV2,
  type GeneralAgentHeldOutTaskV2,
} from './heldOutGeneralAgentBenchmarkV2.js';
import { isGeneralAgentArtifactExpectationV2, type GeneralAgentArtifactExpectationV2 } from './generalAgentArtifactEvidenceV2.js';
import type { ToolName } from './toolRegistry.js';

export const GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2 =
  'origin.general-agent-private-corpus.v1' as const;

export const GENERAL_AGENT_EVALUATOR_PERMISSION_PROFILE_V1 = Object.freeze({
  network: 'raw-disabled',
  groundedResearch: 'allowlisted-public-web-only',
  documentDrafting: 'explicit-opt-in-zero-cost-zdr-provider-only',
  repositoryRead: 'allowed',
  repositoryWrite: 'explicit-approved-only',
  verification: ['test', 'typecheck', 'lint', 'build'],
  externalWrites: 'forbidden',
  paidFallback: false,
  maxCostUsd: 0,
  tools: [
    'code_interpreter',
    'document_generator',
    'web_search_grounding',
    'image_prompt_compiler',
    'repository_explorer',
    'file_reader',
    'file_writer',
    'verification_runner',
  ],
});

const TOOL_NAMES = new Set<ToolName>([
  'code_interpreter',
  'document_generator',
  'web_search_grounding',
  'image_prompt_compiler',
  'repository_explorer',
  'file_reader',
  'file_writer',
  'verification_runner',
]);

const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;

export type GeneralAgentPrivateActionV2 =
  | 'execute'
  | 'cancel-before-approval'
  | 'cancel-after-approval';

export type GeneralAgentPrivateTaskV2 = {
  version: typeof GENERAL_AGENT_HELD_OUT_VERSION_V2;
  id: string;
  taskDigest: string;
  candidateSha: string;
  timeBudgetMs: number;
  capabilities: readonly GeneralAgentCapabilityV2[];
  expectedTerminalStatus: GeneralAgentExpectedTerminalV2;
  recoveryRequired: boolean;
  approvalBoundaryRequired: boolean;
  stopCancelRequired: boolean;
  goal: string;
  expectedTool: ToolName;
  params: Readonly<Record<string, unknown>>;
  action: GeneralAgentPrivateActionV2;
  allowedChangedPaths?: readonly string[];
  artifactExpectation?: GeneralAgentArtifactExpectationV2;
  regressionCheck?: 'none' | 'test' | 'typecheck' | 'lint' | 'build';
};

export type GeneralAgentPrivateCorpusV2 = {
  version: typeof GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2;
  corpusId: string;
  candidateSha: string;
  permissionProfileDigest: string;
  tasks: readonly GeneralAgentPrivateTaskV2[];
};

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

export function digestGeneralAgentPermissionProfileV1(): string {
  return createHash('sha256')
    .update(stable(GENERAL_AGENT_EVALUATOR_PERMISSION_PROFILE_V1), 'utf8')
    .digest('hex');
}

export function digestGeneralAgentPrivateTaskV2(
  task: Omit<GeneralAgentPrivateTaskV2, 'taskDigest'>,
): string {
  return createHash('sha256')
    .update(stable({
      version: task.version,
      id: task.id,
      candidateSha: task.candidateSha.toLowerCase(),
      timeBudgetMs: task.timeBudgetMs,
      capabilities: [...task.capabilities],
      expectedTerminalStatus: task.expectedTerminalStatus,
      recoveryRequired: task.recoveryRequired,
      approvalBoundaryRequired: task.approvalBoundaryRequired,
      stopCancelRequired: task.stopCancelRequired,
      goal: task.goal,
      expectedTool: task.expectedTool,
      params: task.params,
      action: task.action,
      allowedChangedPaths: [...(task.allowedChangedPaths ?? [])],
      regressionCheck: task.regressionCheck ?? 'none',
      ...(task.artifactExpectation === undefined ? {} : { artifactExpectation: task.artifactExpectation }),
    }), 'utf8')
    .digest('hex');
}

function publicTask(task: GeneralAgentPrivateTaskV2): GeneralAgentHeldOutTaskV2 {
  return {
    version: task.version,
    id: task.id,
    taskDigest: task.taskDigest,
    candidateSha: task.candidateSha,
    timeBudgetMs: task.timeBudgetMs,
    capabilities: task.capabilities,
    expectedTerminalStatus: task.expectedTerminalStatus,
    recoveryRequired: task.recoveryRequired,
    approvalBoundaryRequired: task.approvalBoundaryRequired,
    stopCancelRequired: task.stopCancelRequired,
  };
}

export function validateGeneralAgentPrivateCorpusV2(
  corpus: GeneralAgentPrivateCorpusV2,
): readonly string[] {
  const blockers: string[] = [];
  if (corpus?.version !== GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2) blockers.push('PRIVATE_CORPUS_VERSION_INVALID');
  if (!SAFE_ID.test(corpus?.corpusId ?? '')) blockers.push('PRIVATE_CORPUS_ID_INVALID');
  if (!SHA40.test(corpus?.candidateSha ?? '')) blockers.push('PRIVATE_CORPUS_CANDIDATE_SHA_INVALID');
  if (!SHA256.test(corpus?.permissionProfileDigest ?? '')) blockers.push('PRIVATE_CORPUS_PERMISSION_DIGEST_INVALID');
  if (corpus?.permissionProfileDigest !== digestGeneralAgentPermissionProfileV1()) {
    blockers.push('PRIVATE_CORPUS_PERMISSION_PROFILE_MISMATCH');
  }

  const tasks = Array.isArray(corpus?.tasks) ? corpus.tasks : [];
  if (tasks.length < 12 || tasks.length > 24) blockers.push('PRIVATE_CORPUS_TASK_COUNT_INVALID');
  if (new Set(tasks.map(task => task?.id)).size !== tasks.length) blockers.push('PRIVATE_CORPUS_TASK_IDS_DUPLICATE');

  for (const task of tasks) {
    if (task?.action === 'execute' && task?.expectedTerminalStatus === 'completed' && task?.artifactExpectation === undefined) {
      blockers.push(`${task?.id ?? 'unknown'}:PRIVATE_TASK_ARTIFACT_EXPECTATION_REQUIRED`);
    }
    if (task?.artifactExpectation !== undefined && !isGeneralAgentArtifactExpectationV2(task.artifactExpectation)) {
      blockers.push(`${task?.id ?? 'unknown'}:PRIVATE_TASK_ARTIFACT_EXPECTATION_INVALID`);
    }
    blockers.push(...validateGeneralAgentTaskV2(publicTask(task)).map(code => `${task?.id ?? 'unknown'}:${code}`));
    if (task?.candidateSha?.toLowerCase() !== corpus.candidateSha.toLowerCase()) {
      blockers.push(`${task?.id ?? 'unknown'}:PRIVATE_TASK_CANDIDATE_SHA_MISMATCH`);
    }
    if (typeof task?.goal !== 'string' || !task.goal.trim() || task.goal.length > 4000) {
      blockers.push(`${task?.id ?? 'unknown'}:PRIVATE_TASK_GOAL_INVALID`);
    }
    if (!TOOL_NAMES.has(task?.expectedTool)) {
      blockers.push(`${task?.id ?? 'unknown'}:PRIVATE_TASK_TOOL_INVALID`);
    }
    if (!task?.params || typeof task.params !== 'object' || Array.isArray(task.params)) {
      blockers.push(`${task?.id ?? 'unknown'}:PRIVATE_TASK_PARAMS_INVALID`);
    }
    if (!['execute', 'cancel-before-approval', 'cancel-after-approval'].includes(task?.action)) {
      blockers.push(`${task?.id ?? 'unknown'}:PRIVATE_TASK_ACTION_INVALID`);
    }
    if (task.stopCancelRequired && task.action === 'execute') {
      blockers.push(`${task.id}:PRIVATE_TASK_STOP_ACTION_MISSING`);
    }
    if (!task.stopCancelRequired && task.action !== 'execute') {
      blockers.push(`${task.id}:PRIVATE_TASK_STOP_ACTION_UNEXPECTED`);
    }
    if (task.expectedTerminalStatus === 'cancelled' && !task.stopCancelRequired) {
      blockers.push(`${task.id}:PRIVATE_TASK_CANCEL_EXPECTATION_INVALID`);
    }
    if (task.action !== 'execute' && task.expectedTerminalStatus !== 'cancelled') {
      blockers.push(`${task.id}:PRIVATE_TASK_CANCEL_TERMINAL_MISMATCH`);
    }
    if (task.recoveryRequired && task.action !== 'execute') {
      blockers.push(`${task.id}:PRIVATE_TASK_RECOVERY_ACTION_INVALID`);
    }
    if (task.recoveryRequired && !['code_interpreter', 'document_generator'].includes(task.expectedTool)) {
      blockers.push(`${task.id}:PRIVATE_TASK_RECOVERY_TOOL_UNSUPPORTED`);
    }
    if (task.capabilities.includes('research') && task.expectedTool !== 'web_search_grounding') {
      blockers.push(`${task.id}:PRIVATE_TASK_RESEARCH_TOOL_MISMATCH`);
    }
    if (task.expectedTool === 'web_search_grounding' && !task.capabilities.includes('research')) {
      blockers.push(`${task.id}:PRIVATE_TASK_RESEARCH_CAPABILITY_MISSING`);
    }
    if (
      task.expectedTool === 'web_search_grounding'
      && (typeof task.params?.query !== 'string' || !task.params.query.trim() || task.params.query.length > 2000)
    ) {
      blockers.push(`${task.id}:PRIVATE_TASK_RESEARCH_QUERY_INVALID`);
    }
    if (task.capabilities.some(capability =>
      !(GENERAL_AGENT_CAPABILITIES_V2 as readonly string[]).includes(capability))) {
      blockers.push(`${task.id}:PRIVATE_TASK_CAPABILITY_INVALID`);
    }
    const withoutDigest = { ...task } as GeneralAgentPrivateTaskV2;
    delete (withoutDigest as Partial<GeneralAgentPrivateTaskV2>).taskDigest;
    if (!SHA256.test(task.taskDigest) || digestGeneralAgentPrivateTaskV2(withoutDigest as Omit<GeneralAgentPrivateTaskV2, 'taskDigest'>) !== task.taskDigest) {
      blockers.push(`${task.id}:PRIVATE_TASK_DIGEST_MISMATCH`);
    }
    const allowedPaths = task.allowedChangedPaths ?? [];
    if (new Set(allowedPaths).size !== allowedPaths.length || allowedPaths.some(value =>
      typeof value !== 'string' || !value || value.startsWith('/') || value.includes('..') || value.length > 240)) {
      blockers.push(`${task.id}:PRIVATE_TASK_ALLOWED_PATHS_INVALID`);
    }
    if (task.expectedTool === 'file_writer' && allowedPaths.length === 0) {
      blockers.push(`${task.id}:PRIVATE_TASK_WRITE_ALLOWLIST_MISSING`);
    }
    if (task.expectedTool !== 'file_writer' && allowedPaths.length !== 0) {
      blockers.push(`${task.id}:PRIVATE_TASK_WRITE_ALLOWLIST_UNEXPECTED`);
    }
    if (!['none', 'test', 'typecheck', 'lint', 'build'].includes(task.regressionCheck ?? 'none')) {
      blockers.push(`${task.id}:PRIVATE_TASK_REGRESSION_CHECK_INVALID`);
    }
    if (task.expectedTool === 'file_writer' && (task.regressionCheck ?? 'none') === 'none') {
      blockers.push(`${task.id}:PRIVATE_TASK_WRITE_REGRESSION_CHECK_MISSING`);
    }
  }

  const capabilityCoverage = new Set(tasks.flatMap(task => task.capabilities));
  for (const capability of GENERAL_AGENT_CAPABILITIES_V2) {
    if (!capabilityCoverage.has(capability)) blockers.push(`PRIVATE_CORPUS_CAPABILITY_MISSING:${capability}`);
  }
  if (tasks.filter(task => task.recoveryRequired).length < 3) blockers.push('PRIVATE_CORPUS_RECOVERY_TASKS_LT_3');
  if (tasks.filter(task => task.approvalBoundaryRequired).length < 2) blockers.push('PRIVATE_CORPUS_APPROVAL_TASKS_LT_2');
  if (tasks.filter(task => task.stopCancelRequired).length < 2) blockers.push('PRIVATE_CORPUS_STOP_TASKS_LT_2');

  return Object.freeze([...new Set(blockers)]);
}

export function publicGeneralAgentTaskV2(task: GeneralAgentPrivateTaskV2): GeneralAgentHeldOutTaskV2 {
  return publicTask(task);
}
