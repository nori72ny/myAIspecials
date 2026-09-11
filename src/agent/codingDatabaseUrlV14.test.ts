// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveCodingDatabaseUrlV14 } from './codingDatabaseUrlV14.js';

describe('V1.4 coding database URL resolution', () => {
  it('prefers a valid POSTGRES_URL', () => {
    const result = resolveCodingDatabaseUrlV14({
      POSTGRES_URL: 'postgresql://user:pass@db.example.com:5432/origin',
      DATABASE_URL: 'postgresql://other:pass@fallback.example.com:5432/origin',
    });
    expect(result).toEqual({
      source: 'POSTGRES_URL',
      connectionString: 'postgresql://user:pass@db.example.com:5432/origin',
    });
  });

  it('skips a malformed higher-priority URL and uses DATABASE_URL', () => {
    const result = resolveCodingDatabaseUrlV14({
      POSTGRES_URL: 'postgresql://user:bad password@',
      DATABASE_URL: 'postgres://user:pass@fallback.example.com:5432/origin',
    });
    expect(result?.source).toBe('DATABASE_URL');
    expect(result?.connectionString).toBe('postgres://user:pass@fallback.example.com:5432/origin');
  });

  it('falls through to SUPABASE_DB_URL and trims whitespace', () => {
    const result = resolveCodingDatabaseUrlV14({
      POSTGRES_URL: 'https://not-postgres.example.com',
      DATABASE_URL: '   ',
      SUPABASE_DB_URL: '  postgresql://user:pass@supabase.example.com:5432/postgres  ',
    });
    expect(result).toEqual({
      source: 'SUPABASE_DB_URL',
      connectionString: 'postgresql://user:pass@supabase.example.com:5432/postgres',
    });
  });

  it('returns undefined when no parseable postgres URL exists', () => {
    expect(resolveCodingDatabaseUrlV14({
      POSTGRES_URL: 'postgresql://',
      DATABASE_URL: 'file:///tmp/db',
      SUPABASE_DB_URL: 'not-a-url',
    })).toBeUndefined();
  });
});
