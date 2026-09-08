export const OPENROUTER_KEY_METADATA_URL = "https://openrouter.ai/api/v1/key" as const;
const OPENROUTER_KEY_METADATA_TIMEOUT_MS = 5_000;

export function requiresOpenRouterFreeTierAttestation(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

export async function verifyOpenRouterFreeTierAccount(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!key) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_KEY_METADATA_TIMEOUT_MS);
  try {
    const response = await fetchImpl(OPENROUTER_KEY_METADATA_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "User-Agent": "ORIGIN-Personal-Free-Tier-Gate/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null) as { data?: { is_free_tier?: unknown; is_management_key?: unknown } } | null;
    return payload?.data?.is_free_tier === true && payload.data.is_management_key !== true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
