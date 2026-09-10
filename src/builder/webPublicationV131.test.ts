import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResult } from 'pg';
import { generateWebProjectV13 } from './webAppBuilderV13.js';
import {
  MAX_ACTIVE_PUBLICATIONS,
  MAX_PUBLICATION_BYTES,
  PUBLICATION_ID_PATTERN,
  PostgresWebPublicationStore,
  publicationPayloadFromProject,
  type PublicationPayload,
  type PublicationSqlExecutor,
  type PublishedFile,
  type WebPublicationStore,
} from './webPublicationStoreV131.js';
import { createWebPublicationV131Router } from './webPublicationV131Router.js';

const secret = 'x'.repeat(40);
const env = { ORIGIN_AGENT_APPROVAL_SECRET: secret } as NodeJS.ProcessEnv;

class MemoryPublicationStore implements WebPublicationStore {
  readonly records = new Map<string, PublicationPayload>();
  capacityReached = false;
  async publish(payload: PublicationPayload): Promise<boolean> {
    if (this.capacityReached || this.records.has(payload.publicationId)) return false;
    this.records.set(payload.publicationId, payload);
    return true;
  }
  async getFile(publicationId: string, filePath: string): Promise<PublishedFile | null> {
    const record = this.records.get(publicationId);
    if (!record || record.expiresAt <= Date.now()) return null;
    const content = record.files[filePath];
    return typeof content === 'string' ? { content, projectSha256: record.projectSha256, expiresAt: record.expiresAt } : null;
  }
  async remove(publicationId: string): Promise<boolean> { return this.records.delete(publicationId); }
}

function app(store?: WebPublicationStore, runtimeEnv: NodeJS.ProcessEnv = env) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(createWebPublicationV131Router(runtimeEnv, store));
  return app;
}

const projectSpec = {
  kind: 'landing' as const,
  name: 'Public Launch',
  description: 'A harmless public static site.',
  pages: [
    { title: 'Home', headline: 'A verified public launch.', sections: [{ title: 'Highlights', items: [{ title: 'Safe', body: 'Static and dependency free.' }] }] },
    { slug: 'about', title: 'About', headline: 'About this launch.' },
  ],
};

function auth(req: request.Test) { return req.set('Authorization', `Bearer ${secret}`); }

class FakeDb implements PublicationSqlExecutor {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  constructor(private readonly responses: Array<Partial<QueryResult<Record<string, unknown>>>>) {}
  async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    const response = this.responses.shift() ?? { rows: [], rowCount: 0 };
    return { command: '', oid: 0, fields: [], rows: [], rowCount: 0, ...response } as QueryResult<T>;
  }
}

describe('V1.3.1 safe publication', () => {
  it('extracts only public runtime files from a verified project with bounded size', () => {
    const project = generateWebProjectV13(projectSpec);
    const payload = publicationPayloadFromProject(project, 7, Date.now());
    expect(payload.publicationId).toMatch(PUBLICATION_ID_PATTERN);
    expect(payload.projectSha256).toBe(project.sha256);
    expect(Object.keys(payload.files).sort()).toEqual(['about/index.html', 'assets/app.js', 'assets/styles.css', 'index.html']);
    expect(payload.files['origin-manifest.json']).toBeUndefined();
    expect(payload.files['vercel.json']).toBeUndefined();
    expect(payload.files['README.md']).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(payload.files), 'utf8')).toBeLessThan(MAX_PUBLICATION_BYTES * 2);
    expect(() => publicationPayloadFromProject(project, 31)).toThrow('INVALID_PUBLICATION_TTL');
  });

  it('publishes, serves pages/assets with strict headers, and deletes through authenticated flow', async () => {
    const store = new MemoryPublicationStore();
    const publish = await auth(request(app(store)).post('/api/builder/v1.3.1/publish')).send({ project: projectSpec, expiresInDays: 7, confirmPublic: true });
    expect(publish.status).toBe(201);
    expect(publish.body).toMatchObject({ ok: true, verified: true, freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    expect(publish.body.publicationId).toMatch(PUBLICATION_ID_PATTERN);
    expect(publish.body.publicPath).toBe(`/sites/${publish.body.publicationId}/`);

    const home = await request(app(store)).get(publish.body.publicPath);
    expect(home.status).toBe(200);
    expect(home.headers['content-type']).toContain('text/html');
    expect(home.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(home.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(home.headers['x-frame-options']).toBe('DENY');
    expect(home.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(home.text).toContain('A verified public launch.');

    const about = await request(app(store)).get(`/sites/${publish.body.publicationId}/about/`);
    expect(about.status).toBe(200);
    expect(about.text).toContain('About this launch.');
    const js = await request(app(store)).get(`/sites/${publish.body.publicationId}/assets/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.text).not.toContain('fetch(');

    expect((await request(app(store)).get(`/sites/${publish.body.publicationId}/origin-manifest.json`)).status).toBe(404);
    expect((await request(app(store)).get(`/sites/${publish.body.publicationId}/../private`)).status).toBe(404);

    const removed = await auth(request(app(store)).delete(`/api/builder/v1.3.1/publications/${publish.body.publicationId}`));
    expect(removed.status).toBe(200);
    expect((await request(app(store)).get(publish.body.publicPath)).status).toBe(404);
  });

  it('fails closed without configuration, authentication, confirmation, or safe public input', async () => {
    const store = new MemoryPublicationStore();
    const status = await request(app(store)).get('/api/builder/v1.3.1/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ ready: true, freeOnly: true, costUsd: 0, paidFallbackEnabled: false, requiresServerOnlyAuthorization: true });

    const unconfigured = await request(app(undefined, {} as NodeJS.ProcessEnv)).post('/api/builder/v1.3.1/publish').send({ project: projectSpec, confirmPublic: true });
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.body.code).toBe('PUBLICATION_NOT_CONFIGURED');

    const unauthenticated = await request(app(store)).post('/api/builder/v1.3.1/publish').send({ project: projectSpec, confirmPublic: true });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe('PUBLICATION_AUTHENTICATION_REQUIRED');

    const unconfirmed = await auth(request(app(store)).post('/api/builder/v1.3.1/publish')).send({ project: projectSpec });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.code).toBe('PUBLICATION_CONFIRMATION_REQUIRED');

    const sensitive = await auth(request(app(store)).post('/api/builder/v1.3.1/publish')).send({ project: { kind: 'landing', name: 'Blocked', description: 'api_key=xxxxxx' }, confirmPublic: true });
    expect(sensitive.status).toBe(422);
    expect(sensitive.body.code).toBe('SENSITIVE_INPUT_BLOCKED');

    const unsafe = await auth(request(app(store)).post('/api/builder/v1.3.1/publish')).send({ project: { kind: 'landing', name: 'Unsafe', pages: [{ title: 'Home', headline: 'Unsafe', action: { label: 'Run', href: 'javascript:alert(1)' } }] }, confirmPublic: true });
    expect(unsafe.status).toBe(422);
    expect(unsafe.body.code).toBe('PUBLICATION_FAILED_CLOSED');
  });

  it('returns capacity failure rather than switching storage or paid fallback', async () => {
    const store = new MemoryPublicationStore();
    store.capacityReached = true;
    const response = await auth(request(app(store)).post('/api/builder/v1.3.1/publish')).send({ project: projectSpec, confirmPublic: true });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'PUBLICATION_CAPACITY_REACHED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
  });

  it('uses one atomic parameterized Postgres statement for capacity and publish', async () => {
    const project = generateWebProjectV13(projectSpec);
    const payload = publicationPayloadFromProject(project, 7);
    const db = new FakeDb([
      { rows: [{ publication_id: payload.publicationId }], rowCount: 1 },
      { rows: [{ content: '<!doctype html><title>OK</title>', project_sha256: payload.projectSha256, expires_ms: String(payload.expiresAt) }], rowCount: 1 },
      { rows: [{ publication_id: payload.publicationId }], rowCount: 1 },
    ]);
    const store = new PostgresWebPublicationStore(db);
    expect(await store.publish(payload)).toBe(true);
    expect(await store.getFile(payload.publicationId, 'index.html')).toMatchObject({ content: '<!doctype html><title>OK</title>', projectSha256: payload.projectSha256 });
    expect(await store.remove(payload.publicationId)).toBe(true);
    expect(db.calls).toHaveLength(3);
    expect(db.calls[0].text).toContain('pg_advisory_xact_lock');
    expect(db.calls[0].text).toContain('insert into public.origin_builder_publications');
    expect(db.calls[0].text).toContain('$5::jsonb');
    expect(db.calls[0].text).toContain('< $6');
    expect(db.calls[0].values?.[5]).toBe(MAX_ACTIVE_PUBLICATIONS);
    expect(db.calls[1].text).toContain('files ->> $2');
    expect(db.calls[2].text).toContain('publication_id = $1');

    const fullDb = new FakeDb([{ rows: [], rowCount: 0 }]);
    expect(await new PostgresWebPublicationStore(fullDb).publish(payload)).toBe(false);
    expect(fullDb.calls).toHaveLength(1);
    expect(fullDb.calls[0].text).toContain('pg_advisory_xact_lock');
  });
});
