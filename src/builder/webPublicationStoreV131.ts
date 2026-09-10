import { randomBytes } from 'node:crypto';
import { Pool, type QueryResult } from 'pg';
import type { GeneratedWebProject, WebProjectManifest } from './webAppBuilderV13.js';

export const DEFAULT_PUBLICATION_TTL_DAYS = 7;
export const MAX_PUBLICATION_TTL_DAYS = 30;
export const MAX_ACTIVE_PUBLICATIONS = 20;
export const MAX_PUBLICATION_BYTES = 256 * 1024;
export const PUBLICATION_ID_PATTERN = /^site-[A-Za-z0-9_-]{22}$/;

const PUBLIC_FILE_PATTERN = /^(?:index\.html|[a-z0-9-]+\/index\.html|assets\/[A-Za-z0-9._-]+\.(?:css|js))$/;
const MAX_PUBLIC_FILES = 20;

type SqlRow = Record<string, unknown>;
export interface PublicationSqlExecutor {
  query<T extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

export type PublicationPayload = {
  publicationId: string;
  projectSha256: string;
  expiresAt: number;
  manifest: WebProjectManifest;
  files: Record<string, string>;
};

export type PublishedFile = {
  content: string;
  projectSha256: string;
  expiresAt: number;
};

export interface WebPublicationStore {
  publish(payload: PublicationPayload): Promise<boolean>;
  getFile(publicationId: string, filePath: string): Promise<PublishedFile | null>;
  remove(publicationId: string): Promise<boolean>;
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

export function createPublicationId(): string {
  return `site-${randomBytes(16).toString('base64url')}`;
}

function safePublicPath(path: string): boolean {
  return path.length <= 120 && PUBLIC_FILE_PATTERN.test(path) && !path.includes('..') && !path.includes('\\');
}

function extractStoredZip(project: GeneratedWebProject): Record<string, string> {
  const files: Record<string, string> = {};
  let offset = 0;
  let totalBytes = 0;
  let fileCount = 0;

  while (offset + 4 <= project.bytes.length) {
    const signature = project.bytes.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    if (offset + 30 > project.bytes.length) throw new Error('INVALID_PUBLICATION_ARCHIVE');

    const flags = project.bytes.readUInt16LE(offset + 6);
    const method = project.bytes.readUInt16LE(offset + 8);
    const compressedSize = project.bytes.readUInt32LE(offset + 18);
    const uncompressedSize = project.bytes.readUInt32LE(offset + 22);
    const nameLength = project.bytes.readUInt16LE(offset + 26);
    const extraLength = project.bytes.readUInt16LE(offset + 28);
    if ((flags & 0x0001) !== 0 || method !== 0 || compressedSize !== uncompressedSize) throw new Error('INVALID_PUBLICATION_ARCHIVE');

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + uncompressedSize;
    if (dataEnd > project.bytes.length) throw new Error('INVALID_PUBLICATION_ARCHIVE');

    const name = project.bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (safePublicPath(name)) {
      fileCount += 1;
      totalBytes += uncompressedSize;
      if (fileCount > MAX_PUBLIC_FILES || totalBytes > MAX_PUBLICATION_BYTES) throw new Error('PUBLICATION_SIZE_LIMIT_EXCEEDED');
      const raw = project.bytes.subarray(dataStart, dataEnd);
      const text = raw.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(raw)) throw new Error('INVALID_PUBLICATION_TEXT');
      files[name] = text;
    }
    offset = dataEnd;
  }

  if (!files['index.html'] || !files['assets/styles.css'] || !files['assets/app.js']) throw new Error('PUBLICATION_REQUIRED_FILES_MISSING');
  for (const page of project.manifest.pages) if (!files[page.path]) throw new Error('PUBLICATION_REQUIRED_FILES_MISSING');
  return files;
}

export function publicationPayloadFromProject(project: GeneratedWebProject, ttlDays = DEFAULT_PUBLICATION_TTL_DAYS, now = Date.now()): PublicationPayload {
  if (!project.verified || !/^[0-9a-f]{64}$/.test(project.sha256)) throw new Error('UNVERIFIED_PUBLICATION_PROJECT');
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > MAX_PUBLICATION_TTL_DAYS) throw new Error('INVALID_PUBLICATION_TTL');
  const files = extractStoredZip(project);
  return {
    publicationId: createPublicationId(),
    projectSha256: project.sha256,
    expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
    manifest: project.manifest,
    files,
  };
}

export class PostgresWebPublicationStore implements WebPublicationStore {
  constructor(private readonly database: PublicationSqlExecutor) {}

  async publish(payload: PublicationPayload): Promise<boolean> {
    const now = Date.now();
    if (!PUBLICATION_ID_PATTERN.test(payload.publicationId)) throw new Error('INVALID_PUBLICATION_ID');
    if (!/^[0-9a-f]{64}$/.test(payload.projectSha256)) throw new Error('INVALID_PUBLICATION_SHA');
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now || payload.expiresAt > now + MAX_PUBLICATION_TTL_DAYS * 24 * 60 * 60 * 1000 + 10_000) throw new Error('INVALID_PUBLICATION_EXPIRY');
    const serializedFiles = JSON.stringify(payload.files);
    const serializedManifest = JSON.stringify(payload.manifest);
    if (Buffer.byteLength(serializedFiles, 'utf8') > MAX_PUBLICATION_BYTES * 2) throw new Error('PUBLICATION_SIZE_LIMIT_EXCEEDED');

    // Capacity checking and insertion must be one database statement. The transaction-
    // scoped advisory lock serializes concurrent publishers across serverless instances,
    // preventing a race where multiple requests observe the same remaining slot.
    const inserted = await this.database.query<{ publication_id: string }>(
      `with capacity_lock as materialized (
         select pg_advisory_xact_lock(hashtextextended('origin_builder_publications', 0)) as locked
       ), cleanup as (
         delete from public.origin_builder_publications
         where expires_at <= clock_timestamp()
       ), capacity as materialized (
         select count(*)::int as active_count
         from public.origin_builder_publications, capacity_lock
         where expires_at > clock_timestamp()
       ), inserted as (
         insert into public.origin_builder_publications
           (publication_id, project_sha256, expires_at, manifest, files)
         select $1, $2, to_timestamp($3 / 1000.0), $4::jsonb, $5::jsonb
         where (select active_count from capacity) < $6
         on conflict (publication_id) do nothing
         returning publication_id
       )
       select publication_id from inserted`,
      [payload.publicationId, payload.projectSha256, payload.expiresAt, serializedManifest, serializedFiles, MAX_ACTIVE_PUBLICATIONS],
    );
    return inserted.rowCount === 1;
  }

  async getFile(publicationId: string, filePath: string): Promise<PublishedFile | null> {
    if (!PUBLICATION_ID_PATTERN.test(publicationId) || !safePublicPath(filePath)) return null;
    const result = await this.database.query<{ content: string | null; project_sha256: string; expires_ms: string }>(
      `with cleanup as (
         delete from public.origin_builder_publications where expires_at <= clock_timestamp()
       )
       select files ->> $2 as content,
              project_sha256,
              floor(extract(epoch from expires_at) * 1000)::text as expires_ms
       from public.origin_builder_publications
       where publication_id = $1
         and expires_at > clock_timestamp()
         and files ? $2
       limit 1`,
      [publicationId, filePath],
    );
    const row = result.rows[0];
    if (!row || typeof row.content !== 'string') return null;
    return { content: row.content, projectSha256: row.project_sha256, expiresAt: Number(row.expires_ms) };
  }

  async remove(publicationId: string): Promise<boolean> {
    if (!PUBLICATION_ID_PATTERN.test(publicationId)) return false;
    const result = await this.database.query<{ publication_id: string }>(
      `delete from public.origin_builder_publications where publication_id = $1 returning publication_id`,
      [publicationId],
    );
    return result.rowCount === 1;
  }
}

export function createWebPublicationStoreFromEnv(env: NodeJS.ProcessEnv = process.env): WebPublicationStore | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000, allowExitOnIdle: true });
  return new PostgresWebPublicationStore(pool);
}
