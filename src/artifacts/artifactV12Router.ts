import { Router } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import { generateArtifactV12, type ArtifactRequest, type ArtifactType } from './artifactGeneratorV12.js';

const TYPES: readonly ArtifactType[] = ['markdown', 'csv', 'pdf', 'docx', 'xlsx'];
const isType = (value: unknown): value is ArtifactType => typeof value === 'string' && TYPES.includes(value as ArtifactType);

export function createArtifactV12Router() {
  const router = Router();

  router.get('/api/artifacts/v1.2/status', (_req, res) => res.status(200).json({
    ok: true,
    version: '1.2',
    capability: 'real-artifact-generation',
    formats: TYPES,
    delivery: 'verified-download',
    persistence: 'client-save-only',
    freeOnly: true,
    costUsd: 0,
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
  }));

  router.post('/api/artifacts/v1.2/generate', (req, res) => {
    const body = (req.body ?? {}) as Partial<ArtifactRequest>;
    if (!isType(body.type)) return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_TYPE' });
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 200)) return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_TITLE' });
    if (body.content !== undefined && (typeof body.content !== 'string' || body.content.length > 120000)) return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_CONTENT' });
    if (body.rows !== undefined && (!Array.isArray(body.rows) || body.rows.length > 1000 || body.rows.some(row => !Array.isArray(row) || row.length > 100))) {
      return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_ROWS' });
    }

    const sensitiveText = JSON.stringify({ title: body.title ?? '', content: body.content ?? '', rows: body.rows ?? [] });
    const sensitiveKinds = detectSensitiveConversation([{ role: 'user', content: sensitiveText }]);
    if (sensitiveKinds.length > 0) return res.status(422).json({
      ok: false,
      code: 'SENSITIVE_INPUT_BLOCKED',
      message: 'Potentially sensitive input was detected, so ORIGIN did not generate or persist the artifact.',
      sensitiveKinds,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    });

    try {
      const artifact = generateArtifactV12(body as ArtifactRequest);
      if (!artifact.verified) return res.status(422).json({ ok: false, code: 'ARTIFACT_VERIFICATION_FAILED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', artifact.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename.replace(/"/g, '')}"`);
      res.setHeader('X-Origin-Artifact-Sha256', artifact.sha256);
      res.setHeader('X-Origin-Artifact-Verified', 'true');
      res.setHeader('X-Origin-Free-Only', 'true');
      res.setHeader('X-Origin-Cost-Usd', '0');
      return res.status(200).send(artifact.bytes);
    } catch {
      return res.status(422).json({ ok: false, code: 'ARTIFACT_GENERATION_FAILED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
  });

  return router;
}
