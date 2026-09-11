const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const PORT_PATTERN = /^\d{1,5}$/;

export type CodingDatabaseUrlSourceV14 =
  | 'POSTGRES_URL'
  | 'POSTGRES_COMPONENTS'
  | 'DATABASE_URL'
  | 'SUPABASE_DB_URL'
  | 'POSTGRES_URL_NON_POOLING';

export type CodingDatabaseUrlResolutionV14 = {
  connectionString: string;
  source: CodingDatabaseUrlSourceV14;
};

function normalizePostgresUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (!POSTGRES_PROTOCOLS.has(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function buildPostgresUrlFromComponents(env: NodeJS.ProcessEnv): string | undefined {
  const rawHost = env.POSTGRES_HOST?.trim();
  const user = env.POSTGRES_USER;
  const password = env.POSTGRES_PASSWORD;
  const database = env.POSTGRES_DATABASE?.trim();
  if (!rawHost || user === undefined || password === undefined || !database) return undefined;

  try {
    const hostUrl = new URL(`postgresql://${rawHost}`);
    if (!hostUrl.hostname || hostUrl.username || hostUrl.password || hostUrl.pathname !== '/') return undefined;

    const explicitPort = env.POSTGRES_PORT?.trim();
    const port = explicitPort && PORT_PATTERN.test(explicitPort) && Number(explicitPort) >= 1 && Number(explicitPort) <= 65_535
      ? explicitPort
      : hostUrl.port || '5432';

    const parsed = new URL('postgresql://placeholder.invalid/placeholder');
    parsed.hostname = hostUrl.hostname;
    parsed.port = port;
    parsed.username = user;
    parsed.password = password;
    parsed.pathname = `/${database}`;
    parsed.searchParams.set('sslmode', 'require');
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function resolveCodingDatabaseUrlV14(env: NodeJS.ProcessEnv = process.env): CodingDatabaseUrlResolutionV14 | undefined {
  const postgresUrl = normalizePostgresUrl(env.POSTGRES_URL);
  if (postgresUrl) return { connectionString: postgresUrl, source: 'POSTGRES_URL' };

  const componentsUrl = buildPostgresUrlFromComponents(env);
  if (componentsUrl) return { connectionString: componentsUrl, source: 'POSTGRES_COMPONENTS' };

  const candidates: Array<[CodingDatabaseUrlSourceV14, string | undefined]> = [
    ['DATABASE_URL', env.DATABASE_URL],
    ['SUPABASE_DB_URL', env.SUPABASE_DB_URL],
    ['POSTGRES_URL_NON_POOLING', env.POSTGRES_URL_NON_POOLING],
  ];
  for (const [source, raw] of candidates) {
    const connectionString = normalizePostgresUrl(raw);
    if (connectionString) return { connectionString, source };
  }
  return undefined;
}
