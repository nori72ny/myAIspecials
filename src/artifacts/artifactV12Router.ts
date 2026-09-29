import { Router } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import { artifactSelfTestV12, generateArtifactV12, type ArtifactRequest, type ArtifactType } from './artifactGeneratorV12.js';

const TYPES: readonly ArtifactType[] = ['markdown', 'csv', 'pdf', 'docx', 'xlsx', 'pptx'];
const isType = (value: unknown): value is ArtifactType => typeof value === 'string' && TYPES.includes(value as ArtifactType);
const isCell = (value: unknown): value is string | number | boolean | null => value === null
  || typeof value === 'string'
  || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));

export function createArtifactV12Router() {
  const router = Router();

  router.get('/api/artifacts/v1.2/status', (_req, res) => {
    const selfTest = artifactSelfTestV12();
    return res.status(200).json({
      ok: true,
      ready: selfTest.ready,
      version: '1.2',
      capability: 'real-artifact-generation',
      formats: TYPES,
      generatorSelfTest: selfTest.formats,
      formatLimitations: { pdf: 'ASCII text only until a verified embedded-Unicode renderer is available; unsupported text fails closed.' },
      delivery: 'verified-download',
      persistence: 'client-save-only',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });
  });

  router.post('/api/artifacts/v1.2/generate', (req, res) => {
    const body = (req.body ?? {}) as Partial<ArtifactRequest>;
    if (!isType(body.type)) return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_TYPE' });
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 200)) return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_TITLE' });
    if (body.content !== undefined && (typeof body.content !== 'string' || body.content.length > 120000)) return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_CONTENT' });
    if (body.rows !== undefined && (!Array.isArray(body.rows) || body.rows.length > 1000 || body.rows.some(row => !Array.isArray(row) || row.length > 100 || row.some(value => !isCell(value))))) {
      return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_ROWS' });
    }
    if (body.slides !== undefined && (!Array.isArray(body.slides) || body.slides.length === 0 || body.slides.length > 50 || body.slides.some(slide => !slide || typeof slide !== 'object' || Array.isArray(slide) || (slide.title !== undefined && (typeof slide.title !== 'string' || slide.title.length > 200)) || (slide.content !== undefined && (typeof slide.content !== 'string' || slide.content.length > 10000))))) {
      return res.status(400).json({ ok: false, code: 'INVALID_ARTIFACT_SLIDES' });
    }

    const sensitiveText = JSON.stringify({ title: body.title ?? '', content: body.content ?? '', rows: body.rows ?? [], slides: body.slides ?? [] });
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
      const fallback = artifact.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const encoded = encodeURIComponent(artifact.filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
      res.setHeader('X-Origin-Artifact-Sha256', artifact.sha256);
      res.setHeader('X-Origin-Artifact-Verified', 'true');
      res.setHeader('X-Origin-Free-Only', 'true');
      res.setHeader('X-Origin-Cost-Usd', '0');
      return res.status(200).send(artifact.bytes);
    } catch (error) {
      if (error instanceof Error && error.message === 'PDF_UNICODE_RENDERING_UNAVAILABLE') {
        return res.status(422).json({
          ok: false,
          code: 'PDF_UNICODE_RENDERING_UNAVAILABLE',
          message: 'ORIGIN stopped instead of generating a PDF that could corrupt non-ASCII text.',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
        });
      }
      return res.status(422).json({ ok: false, code: 'ARTIFACT_GENERATION_FAILED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
  });

  return router;
}
