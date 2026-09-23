import { timingSafeEqual } from 'node:crypto';
import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginProviderDataPolicy,
} from '../lib/orchestration/OriginExecutionPolicy.js';
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from '../legacy/originProviderClient.js';

export const TRUSTED_CANDIDATE_PROVIDER_REQUEST_LIMIT_V15 = 7 as const;
export const TRUSTED_CANDIDATE_PROVIDER_MAX_REQUEST_BYTES_V15 = 384 * 1024;

export type TrustedCandidateProviderExecuteV15 = (
  request: OriginProviderExecutionRequest,
) => Promise<OriginProviderExecutionResult>;

export class TrustedCandidateProviderBoundaryErrorV15 extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = 'TrustedCandidateProviderBoundaryErrorV15';
  }
}

function fail(code: string, status = 400): never {
  throw new TrustedCandidateProviderBoundaryErrorV15(code, status);
}

function exactDataPolicy(value: OriginProviderDataPolicy): boolean {
  return value?.allowProviderFallbacks === false
    && value?.dataCollection === 'deny'
    && value?.requireZeroDataRetention === true;
}

function safeTool(request: OriginProviderExecutionRequest): boolean {
  const tool = request.requiredTool;
  if (!tool || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)) return false;
  if (typeof tool.description !== 'string' || !tool.description || tool.description.length > 1000) return false;
  if (!tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)) return false;
  return Buffer.byteLength(JSON.stringify(tool.parameters), 'utf8') <= 32 * 1024;
}

export function validateTrustedCandidateProviderRequestV15(
  value: unknown,
): OriginProviderExecutionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TRUSTED_PROVIDER_REQUEST_INVALID');
  let serialized: string;
  try { serialized = JSON.stringify(value); }
  catch { fail('TRUSTED_PROVIDER_REQUEST_INVALID'); }
  if (Buffer.byteLength(serialized, 'utf8') > TRUSTED_CANDIDATE_PROVIDER_MAX_REQUEST_BYTES_V15) {
    fail('TRUSTED_PROVIDER_REQUEST_TOO_LARGE', 413);
  }

  const request = value as OriginProviderExecutionRequest;
  const plan = request.plan;
  if (
    !plan
    || plan.providerId !== 'openrouter-free'
    || plan.modelId !== ORIGIN_OPENROUTER_FREE_MODEL
    || plan.taskType !== 'implementation'
    || plan.freeOnly !== true
    || plan.estimatedCostUsd !== 0
    || !exactDataPolicy(plan.providerDataPolicy)
  ) {
    fail('TRUSTED_PROVIDER_POLICY_VIOLATION');
  }

  if (typeof request.systemInstruction !== 'string' || !request.systemInstruction || request.systemInstruction.length > 32_000) {
    fail('TRUSTED_PROVIDER_SYSTEM_INVALID');
  }
  if (!Array.isArray(request.messages) || request.messages.length < 1 || request.messages.length > 8) {
    fail('TRUSTED_PROVIDER_MESSAGES_INVALID');
  }
  for (const message of request.messages) {
    if (!message || typeof message !== 'object') fail('TRUSTED_PROVIDER_MESSAGES_INVALID');
    if (!['user', 'ai', 'assistant', 'model'].includes(message.role)) fail('TRUSTED_PROVIDER_MESSAGES_INVALID');
    if (typeof message.content !== 'string' || !message.content || message.content.length > 320_000) {
      fail('TRUSTED_PROVIDER_MESSAGES_INVALID');
    }
  }
  if (!safeTool(request)) fail('TRUSTED_PROVIDER_TOOL_INVALID');

  return request;
}

function tokenMatches(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createTrustedCandidateProviderBoundaryV15(options: {
  token: string;
  execute: TrustedCandidateProviderExecuteV15;
  limit?: number;
}) {
  const limit = options.limit ?? TRUSTED_CANDIDATE_PROVIDER_REQUEST_LIMIT_V15;
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error('TRUSTED_PROVIDER_TOKEN_INVALID');
  if (!Number.isInteger(limit) || limit < 1 || limit > TRUSTED_CANDIDATE_PROVIDER_REQUEST_LIMIT_V15) {
    throw new Error('TRUSTED_PROVIDER_LIMIT_INVALID');
  }

  let used = 0;
  return {
    used: () => used,
    remaining: () => limit - used,
    async execute(presentedToken: string, rawRequest: unknown): Promise<OriginProviderExecutionResult> {
      if (!tokenMatches(options.token, presentedToken)) fail('TRUSTED_PROVIDER_UNAUTHORIZED', 401);
      if (used >= limit) fail('TRUSTED_PROVIDER_BUDGET_EXHAUSTED', 429);
      const request = validateTrustedCandidateProviderRequestV15(rawRequest);
      used += 1;
      return options.execute(request);
    },
  };
}

export function publicTrustedProviderErrorV15(error: unknown): {
  code: string;
  status: number;
} {
  if (error instanceof TrustedCandidateProviderBoundaryErrorV15) {
    return { code: error.code, status: error.status };
  }
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    const status = (error as { status?: unknown }).status;
    if (typeof code === 'string' && /^PROVIDER_[A-Z0-9_:-]+$/.test(code)) {
      return {
        code,
        status: Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599 ? Number(status) : 502,
      };
    }
  }
  return { code: 'TRUSTED_PROVIDER_EXECUTION_FAILED', status: 502 };
}
