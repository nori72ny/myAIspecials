import { Router, type Response } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import {
  VISUAL_KINDS_V15,
  VISUAL_LAYOUTS_V15,
  VISUAL_PRESETS_V15,
  VisualArtifactValidationErrorV15,
  generateVisualArtifactV15,
  visualArtifactSelfTestV15,
} from './visualArtifactV15.js';

function sensitiveKinds(body: unknown): string[] {
  let serialized = '';
  try { serialized = JSON.stringify(body ?? {}); } catch { return ['unserializable_input']; }
  return detectSensitiveConversation([{ role: 'user', content: serialized }]);
}

function safeFailure(res: Response, status: number, code: string) {
  return res.status(status).json({
    ok: false,
    code,
    freeOnly: true,
    costUsd: 0,
    paidFallbackUsed: false,
    externalNetworkRequests: 0,
  });
}

function utf8DownloadDisposition(filename: string, fallback: string): string {
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createVisualArtifactV15Router() {
  const router = Router();

  router.get('/api/creative/v1.5/status', (_req, res) => {
    const selfTest = visualArtifactSelfTestV15();
    return res.status(selfTest.ready ? 200 : 503).json({
      ok: true,
      ready: selfTest.ready,
      version: '1.5',
      releaseStage: 'verified-vector-foundation',
      capability: 'verified-static-vector-visual-generation',
      formats: ['svg'],
      kinds: VISUAL_KINDS_V15,
      presets: VISUAL_PRESETS_V15,
      layouts: VISUAL_LAYOUTS_V15,
      output: 'verified-svg-download',
      verification: [
        'bounded-bytes',
        'svg-root',
        'exact-viewport',
        'no-script',
        'no-foreign-object',
        'no-embedded-image',
        'no-external-reference',
        'no-event-handlers',
      ],
      generationMode: 'deterministic-local',
      externalRuntimeDependencies: 0,
      externalNetworkRequests: 0,
      providerExecutions: 0,
      rasterImageGeneration: false,
      modelBasedImageEditing: false,
      persistence: 'client-save-only',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      selfTest,
    });
  });

  router.post('/api/creative/v1.5/generate', (req, res) => {
    const kinds = sensitiveKinds(req.body);
    if (kinds.length > 0) {
      return res.status(422).json({
        ok: false,
        code: 'SENSITIVE_INPUT_BLOCKED',
        message: 'Potentially sensitive input was detected, so ORIGIN did not generate or persist the visual artifact.',
        sensitiveKinds: kinds,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
        externalNetworkRequests: 0,
      });
    }

    try {
      const artifact = generateVisualArtifactV15(req.body);
      if (!artifact.verified) return safeFailure(res, 422, 'VISUAL_ARTIFACT_VERIFICATION_FAILED');
      const fallbackName = `origin-${artifact.kind}-${artifact.preset}.svg`;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', artifact.mimeType);
      res.setHeader('Content-Disposition', utf8DownloadDisposition(artifact.filename, fallbackName));
      res.setHeader('X-Origin-Visual-Sha256', artifact.sha256);
      res.setHeader('X-Origin-Visual-Verified', 'true');
      res.setHeader('X-Origin-Free-Only', 'true');
      res.setHeader('X-Origin-Cost-Usd', '0');
      res.setHeader('X-Origin-External-Network', 'false');
      return res.status(200).send(artifact.bytes);
    } catch (error) {
      if (error instanceof VisualArtifactValidationErrorV15) return safeFailure(res, 400, error.code);
      return safeFailure(res, 422, 'VISUAL_ARTIFACT_GENERATION_FAILED');
    }
  });

  return router;
}
