const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export type CodingDatabaseUrlSourceV14 = 'POSTGRES_URL' | 'DATABASE_URL' | 'SUPABASE_DB_URL';

export type CodingDatabaseUrlResolutionV14 = {
  connectionString: string;
  source: CodingDatabaseUrlSourceV14;
};

const CANDIDATES: readonly CodingDatabaseUrlSourceV14[] = [
  'POSTGRES_URL',
  'DATABASE_URL',
  'SUPABASE_DB_URL',
];

/**
 * Resolve only a syntactically valid PostgreSQL URL. A stale or malformed higher
 * priority variable must not mask a valid lower-priority production connection.
 * Never log or expose the returned connection string.
 */
export function resolveCodingDatabaseUrlV14(env: NodeJS.ProcessEnv = process.env): CodingDatabaseUrlResolutionV14 | undefined {
  for (const source of CANDIDATES) {
    const raw = env[source];
    if (!raw) continue;
    const value = raw.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) continue;
      if (!parsed.hostname) continue;
      return { connectionString: value, source };
    } catch {
      continue;
    }
  }
  return undefined;
}
