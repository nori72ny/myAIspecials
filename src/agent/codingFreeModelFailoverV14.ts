import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from '../legacy/originProviderClient.js';
import { sanitizePreEgress, sanitizePreEgressPayload } from '../services/securitySanitizer.js';
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from '../legacy/zeroCostRoutingPolicy.js';

export const ORIGIN_CODING_FREE_FAILOVER_MODEL_V14 = 'cohere/north-mini-code:free' as const;
export const ORIGIN_CODING_FREE_FAILOVER_SOURCE_V14 = 'https://openrouter.ai/cohere/north-mini-code:free' as const;
export const ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14 = '2026-09-16T00:00:00.000Z' as const;
export const ORIGIN_CODING_FREE_FAILOVER_REVIEW_AFTER_V14 = '2026-09-23T00:00:00.000Z' as const;

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 6_000;
const MAX_TOOL_SCHEMA_BYTES = 32 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
const CANONICAL_MODEL = ORIGIN_CODING_FREE_FAILOVER_MODEL_V14.replace(/:free$/, '');

function fail(code: ConstructorParameters<typeof OriginProviderError>[0], status = 502): never {
  throw new OriginProviderError(code, code, status, false);
}

function assertCurrentEvidence(nowMs: number): void {
  const verifiedAt = Date.parse(ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14);
  const reviewAfter = Date.parse(ORIGIN_CODING_FREE_FAILOVER_REVIEW_AFTER_V14);
  if (!Number.isFinite(nowMs) || nowMs < verifiedAt || nowMs > reviewAfter) fail('PROVIDER_POLICY_VIOLATION', 400);
}

function assertRequestBoundary(request: OriginProviderExecutionRequest): asserts request is OriginProviderExecutionRequest & { requiredTool: NonNullable<OriginProviderExecutionRequest['requiredTool']> } {
  const policy = request.plan.providerDataPolicy;
  if (
    request.plan.taskType !== 'implementation' ||
    request.plan.providerId !== 'openrouter-free' ||
    request.plan.freeOnly !== true ||
    request.plan.estimatedCostUsd !== 0 ||
    policy.allowProviderFallbacks !== false ||
    policy.dataCollection !== 'deny' ||
    policy.requireZeroDataRetention !== true ||
    !request.requiredTool
  ) fail('PROVIDER_POLICY_VIOLATION', 400);

  const tool = request.requiredTool;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || !tool.description || tool.description.length > 1000) fail('PROVIDER_POLICY_VIOLATION', 400);
  const schema = JSON.stringify(tool.parameters);
  if (Buffer.byteLength(schema, 'utf8') > MAX_TOOL_SCHEMA_BYTES) fail('PROVIDER_POLICY_VIOLATION', 400);
}

function zero(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.EPSILON;
}

function assertZeroCostPayload(data: Record<string, any>): void {
  const reportedCost = data.usage?.cost;
  if (typeof reportedCost !== 'number' || !Number.isFinite(reportedCost)) fail('PROVIDER_COST_UNVERIFIED');
  if (!zero(reportedCost)) fail('PROVIDER_POLICY_VIOLATION');

  const upstream = data.usage?.cost_details?.upstream_inference_cost;
  if (upstream !== undefined && !zero(Number(upstream))) fail('PROVIDER_POLICY_VIOLATION');
  if (data.usage?.is_byok === true) fail('PROVIDER_POLICY_VIOLATION');
  if (data.billing_tier !== undefined && String(data.billing_tier).toLowerCase() !== 'free') fail('PROVIDER_POLICY_VIOLATION');
  if (data.is_free === false) fail('PROVIDER_POLICY_VIOLATION');
  for (const value of [data.pricing?.prompt, data.pricing?.completion]) {
    if (value !== undefined && !zero(Number(value))) fail('PROVIDER_POLICY_VIOLATION');
  }
}

function httpError(response: Response): OriginProviderError {
  if (response.status === 401) return new OriginProviderError('PROVIDER_NOT_CONFIGURED', 'PROVIDER_NOT_CONFIGURED', 401, false);
  if (response.status === 402) return new OriginProviderError('PROVIDER_POLICY_VIOLATION', 'PROVIDER_POLICY_VIOLATION', 502, false);
  if (response.status === 429) return new OriginProviderError('PROVIDER_RATE_LIMITED', 'PROVIDER_RATE_LIMITED', 429, true);
  if (response.status === 408 || response.status === 504) return new OriginProviderError('PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT', 504, true);
  return new OriginProviderError('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 503, response.status >= 500);
}

export async function executeOriginCodingFreeFailoverV14(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  nowMs = Date.now(),
): Promise<OriginProviderExecutionResult> {
  assertCurrentEvidence(nowMs);
  assertRequestBoundary(request);
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) fail('PROVIDER_NOT_CONFIGURED', 401);

  const messages = [
    { role: 'system', content: sanitizePreEgress(request.systemInstruction) },
    ...request.messages.map(message => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: sanitizePreEgress(message.content),
    })),
  ];
  const body = sanitizePreEgressPayload({
    model: ORIGIN_CODING_FREE_FAILOVER_MODEL_V14,
    messages,
    max_tokens: 8192,
    reasoning: { effort: 'minimal', exclude: true },
    tools: [{ type: 'function', function: request.requiredTool }],
    tool_choice: { type: 'function', function: { name: request.requiredTool.name } },
    provider: ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
    usage: { include: true },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Metadata': 'enabled',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new OriginProviderError('PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT', 504, true, undefined, { transportFailure: 'network' });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw httpError(response);

  let data: Record<string, any>;
  try { data = await response.json() as Record<string, any>; }
  catch { throw new OriginProviderError('PROVIDER_INVALID_RESPONSE', 'PROVIDER_INVALID_RESPONSE', 502, true); }

  assertZeroCostPayload(data);
  const servedModel = data.model;
  if (servedModel !== ORIGIN_CODING_FREE_FAILOVER_MODEL_V14 && servedModel !== CANONICAL_MODEL) fail('PROVIDER_ROUTING_UNVERIFIED');

  const choices = Array.isArray(data.choices) ? data.choices : [];
  if (choices.length !== 1) fail('PROVIDER_INVALID_RESPONSE');
  const choice = choices[0] as Record<string, any>;
  const toolCalls = Array.isArray(choice.message?.tool_calls) ? choice.message.tool_calls : [];
  if (choice.finish_reason === 'length') fail('PROVIDER_REQUIRED_TOOL_TRUNCATED');
  if (toolCalls.length === 0) fail('PROVIDER_REQUIRED_TOOL_MISSING');
  if (toolCalls.length !== 1) fail('PROVIDER_REQUIRED_TOOL_AMBIGUOUS');

  const call = toolCalls[0] as Record<string, any>;
  if (call.type !== 'function' || call.function?.name !== request.requiredTool.name) fail('PROVIDER_REQUIRED_TOOL_INVALID');
  const args = call.function?.arguments;
  if (typeof args !== 'string' || !args.trim() || Buffer.byteLength(args, 'utf8') > MAX_TOOL_ARGUMENT_BYTES) fail('PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID');
  try { JSON.parse(args); }
  catch { fail('PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID'); }

  return {
    text: args,
    actualCostUsd: 0,
    usage: {
      promptTokens: typeof data.usage?.prompt_tokens === 'number' ? data.usage.prompt_tokens : undefined,
      completionTokens: typeof data.usage?.completion_tokens === 'number' ? data.usage.completion_tokens : undefined,
      totalTokens: typeof data.usage?.total_tokens === 'number' ? data.usage.total_tokens : undefined,
      costUsd: 0,
    },
    providerDataPolicy: request.plan.providerDataPolicy,
    routingEvidence: {
      requestedModel: ORIGIN_CODING_FREE_FAILOVER_MODEL_V14,
      servedModel,
      strategy: 'coding-free-failover',
      provider: 'OpenRouter',
      attempt: 1,
      fallbackUsed: true,
    },
  };
}
