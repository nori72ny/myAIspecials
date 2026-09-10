import { Router, type Request, type Response } from 'express';
import { authenticateAgentRequest, agentApprovalConfigured } from '../agent/agentApproval.js';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import { generateWebProjectV13 } from './webAppBuilderV13.js';
import {
  DEFAULT_PUBLICATION_TTL_DAYS,
  MAX_ACTIVE_PUBLICATIONS,
  MAX_PUBLICATION_TTL_DAYS,
  PUBLICATION_ID_PATTERN,
  publicationPayloadFromProject,
  type WebPublicationStore,
} from './webPublicationStoreV131.js';

function sensitiveKinds(body: unknown): string[] {
  let serialized = '';
  try { serialized = JSON.stringify(body ?? {}); } catch { return ['unserializable_input']; }
  return detectSensitiveConversation([{ role: 'user', content: serialized }]);
}

function publisherReady(env: NodeJS.ProcessEnv, store: WebPublicationStore | undefined): boolean {
  return Boolean(store) && agentApprovalConfigured(env);
}

function contentType(path: string): string | null {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return null;
}

function publicFilePath(rawPath: string | string[] | undefined): string | null {
  const joined = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath ?? '');
  // Trim in one linear pass; an unanchored trailing-slash regex can backtrack
  // quadratically before the path-length check on attacker-controlled input.
  let start = 0;
  let end = joined.length;
  while (start < end && joined[start] === '/') start += 1;
  while (end > start && joined[end - 1] === '/') end -= 1;
  const clean = joined.slice(start, end);
  if (!clean) return 'index.html';
  if (clean.includes('..') || clean.includes('\\') || clean.length > 120) return null;
  if (/^[a-z0-9-]+$/.test(clean)) return `${clean}/index.html`;
  if (/^(?:assets\/[A-Za-z0-9._-]+\.(?:css|js)|[a-z0-9-]+\/index\.html|index\.html)$/.test(clean)) return clean;
  return null;
}

function setPublishedSiteHeaders(res: Response, mimeType: string, projectSha256: string, expiresAt: number): void {
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Origin-Project-Sha256', projectSha256);
  res.setHeader('X-Origin-Publication-Expires-At', new Date(expiresAt).toISOString());
}

function requirePublicationAuth(req: Request, res: Response, env: NodeJS.ProcessEnv, store: WebPublicationStore | undefined): store is WebPublicationStore {
  if (!publisherReady(env, store)) {
    res.status(503).json({ ok: false, code: 'PUBLICATION_NOT_CONFIGURED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    return false;
  }
  if (!authenticateAgentRequest(req, env)) {
    res.status(401).json({ ok: false, code: 'PUBLICATION_AUTHENTICATION_REQUIRED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    return false;
  }
  return true;
}

export function createWebPublicationV131Router(env: NodeJS.ProcessEnv = process.env, store?: WebPublicationStore) {
  const router = Router();

  router.get('/api/builder/v1.3.1/status', (_req, res) => res.status(200).json({
    ok: true,
    ready: publisherReady(env, store),
    version: '1.3.1',
    capability: 'origin-hosted-static-publication',
    publicationMode: 'authenticated-expiring-static',
    publicBasePath: '/sites',
    defaultPublicationDays: DEFAULT_PUBLICATION_TTL_DAYS,
    maxPublicationDays: MAX_PUBLICATION_TTL_DAYS,
    maxActivePublications: MAX_ACTIVE_PUBLICATIONS,
    requiresServerOnlyAuthorization: true,
    robotsDefault: 'noindex,nofollow',
    persistence: 'bounded-shared-postgres',
    freeOnly: true,
    costUsd: 0,
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
  }));

  router.post('/api/builder/v1.3.1/publish', async (req, res) => {
    if (!requirePublicationAuth(req, res, env, store)) return;
    const body = req.body ?? {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false, code: 'INVALID_PUBLICATION_REQUEST', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    const request = body as Record<string, unknown>;
    if (!Object.keys(request).every(key => ['project', 'expiresInDays', 'confirmPublic'].includes(key)) || request.confirmPublic !== true) {
      return res.status(400).json({ ok: false, code: 'PUBLICATION_CONFIRMATION_REQUIRED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
    const ttlDays = request.expiresInDays === undefined ? DEFAULT_PUBLICATION_TTL_DAYS : request.expiresInDays;
    if (!Number.isInteger(ttlDays) || Number(ttlDays) < 1 || Number(ttlDays) > MAX_PUBLICATION_TTL_DAYS) {
      return res.status(400).json({ ok: false, code: 'INVALID_PUBLICATION_TTL', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
    const kinds = sensitiveKinds(request.project);
    if (kinds.length > 0) return res.status(422).json({
      ok: false,
      code: 'SENSITIVE_INPUT_BLOCKED',
      message: 'Potentially sensitive input was detected, so ORIGIN did not publish or persist the project.',
      sensitiveKinds: kinds,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    });

    try {
      const project = generateWebProjectV13(request.project);
      if (!project.verified) return res.status(422).json({ ok: false, code: 'WEB_PROJECT_VERIFICATION_FAILED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
      const payload = publicationPayloadFromProject(project, Number(ttlDays));
      const inserted = await store.publish(payload);
      if (!inserted) return res.status(409).json({ ok: false, code: 'PUBLICATION_CAPACITY_REACHED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
      return res.status(201).json({
        ok: true,
        publicationId: payload.publicationId,
        publicPath: `/sites/${payload.publicationId}/`,
        expiresAt: new Date(payload.expiresAt).toISOString(),
        projectSha256: payload.projectSha256,
        verified: true,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    } catch {
      return res.status(422).json({ ok: false, code: 'PUBLICATION_FAILED_CLOSED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
  });

  router.delete('/api/builder/v1.3.1/publications/:publicationId', async (req, res) => {
    if (!requirePublicationAuth(req, res, env, store)) return;
    const publicationId = req.params.publicationId;
    if (typeof publicationId !== 'string' || !PUBLICATION_ID_PATTERN.test(publicationId)) return res.status(404).json({ ok: false, code: 'PUBLICATION_NOT_FOUND' });
    try {
      const removed = await store.remove(publicationId);
      if (!removed) return res.status(404).json({ ok: false, code: 'PUBLICATION_NOT_FOUND' });
      return res.status(200).json({ ok: true, removed: true, publicationId, freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    } catch {
      return res.status(503).json({ ok: false, code: 'PUBLICATION_STORE_UNAVAILABLE', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
  });

  const serve = async (req: Request, res: Response) => {
    if (!store) return res.status(404).type('text/plain').send('Not found');
    const publicationId = req.params.publicationId;
    const rawPath = req.params.assetPath as string | string[] | undefined;
    if (typeof publicationId !== 'string' || !PUBLICATION_ID_PATTERN.test(publicationId)) return res.status(404).type('text/plain').send('Not found');
    const filePath = publicFilePath(rawPath);
    if (!filePath) return res.status(404).type('text/plain').send('Not found');
    const mimeType = contentType(filePath);
    if (!mimeType) return res.status(404).type('text/plain').send('Not found');
    try {
      const file = await store.getFile(publicationId, filePath);
      if (!file) return res.status(404).type('text/plain').send('Not found');
      setPublishedSiteHeaders(res, mimeType, file.projectSha256, file.expiresAt);
      return res.status(200).send(file.content);
    } catch {
      return res.status(503).type('text/plain').send('Publication temporarily unavailable');
    }
  };

  router.get('/sites/:publicationId', serve);
  router.get('/sites/:publicationId/', serve);
  router.get('/sites/:publicationId/{*assetPath}', serve);

  return router;
}
