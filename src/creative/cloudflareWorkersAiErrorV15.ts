export type CloudflareWorkersAiFailureV15 = {
  code: string;
  retryable: boolean;
  internalCode: number | null;
  httpStatus: number;
};

type CloudflareErrorItem = {
  code?: unknown;
  message?: unknown;
};

type CloudflareErrorEnvelope = {
  errors?: unknown;
};

function internalCodeFrom(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const errors = (value as CloudflareErrorEnvelope).errors;
  if (!Array.isArray(errors)) return null;
  for (const error of errors as CloudflareErrorItem[]) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    if (typeof code === 'number' && Number.isInteger(code)) return code;
    if (typeof code === 'string' && /^\d+$/.test(code)) return Number(code);
  }
  return null;
}

export async function classifyCloudflareWorkersAiFailureV15(
  response: Response,
  genericPrefix = 'CLOUDFLARE_WORKERS_AI_HTTP',
): Promise<CloudflareWorkersAiFailureV15> {
  const status = response.status;
  let internalCode: number | null = null;
  try {
    const body = await response.json() as unknown;
    internalCode = internalCodeFrom(body);
  } catch {
    internalCode = null;
  }

  if (internalCode === 3036) {
    return {
      code: 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED',
      retryable: false,
      internalCode,
      httpStatus: status,
    };
  }
  if (internalCode === 3040) {
    return {
      code: 'CLOUDFLARE_WORKERS_AI_CAPACITY_UNAVAILABLE',
      retryable: true,
      internalCode,
      httpStatus: status,
    };
  }
  if (internalCode === 5035) {
    return {
      code: 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN',
      retryable: false,
      internalCode,
      httpStatus: status,
    };
  }
  if (internalCode === 10000 || status === 401) {
    return {
      code: 'CLOUDFLARE_WORKERS_AI_AUTH_REQUIRED',
      retryable: false,
      internalCode,
      httpStatus: status,
    };
  }
  if (status === 403) {
    return {
      code: 'CLOUDFLARE_WORKERS_AI_ACCESS_DENIED',
      retryable: false,
      internalCode,
      httpStatus: status,
    };
  }
  if (status === 429) {
    return {
      code: 'CLOUDFLARE_FREE_OR_CAPACITY_UNAVAILABLE',
      retryable: false,
      internalCode,
      httpStatus: status,
    };
  }
  if (status === 402) {
    return {
      code: 'CLOUDFLARE_PAID_PATH_BLOCKED',
      retryable: false,
      internalCode,
      httpStatus: status,
    };
  }

  return {
    code: `${genericPrefix}_${status}`,
    retryable: status >= 500,
    internalCode,
    httpStatus: status,
  };
}
