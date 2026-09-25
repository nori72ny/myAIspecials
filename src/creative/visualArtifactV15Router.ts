import { createHash } from 'node:crypto';
import { Router, type Response } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import {
  VISUAL_KINDS_V15,
  VISUAL_LAYOUTS_V15,
  VISUAL_PRESETS_V15,
  VisualArtifactValidationErrorV15,
  generateVisualArtifactV15,
  parseVisualArtifactRequestV15,
  visualArtifactSelfTestV15,
} from './visualArtifactV15.js';
import {
  planVisualBrainV15,
  visualBrainSelfTestV15,
  visualProviderRegistryV15,
} from './visualBrainV15.js';
import { getRasterProviderStatusV15 } from './rasterImageProviderV15.js';

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

export function createVisualArtifactV15Router(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/creative/v1.5/status', async (_req, res) => {
    const selfTest = visualArtifactSelfTestV15();
    const visualBrain = visualBrainSelfTestV15();
    const raster = await getRasterProviderStatusV15(env);
    const ready = selfTest.ready && visualBrain.ready;
    return res.status(ready ? 200 : 503).json({
      ok: true,
      ready,
      version: '1.5',
      releaseStage: 'verified-vector-foundation',
      capability: 'verified-static-vector-visual-generation',
      visualBrain: {
        version: 'visual-brain-v1',
        ready: visualBrain.ready,
        checks: visualBrain.checks,
        stages: [
          'intent',
          'scene-plan',
          'composition',
          'typography',
          'change-preserve',
          'prompt-compile',
          'provider-route',
          'critic-rubric',
          'bounded-repair-policy',
        ],
        providerAgnostic: true,
        generatorCriticRepair: 'planned-bounded-loop',
        bestOfN: 'provider-dependent',
        typographyStrategy: 'deterministic-overlay',
        providers: visualProviderRegistryV15(),
      },
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
      rasterImageGeneration: raster.ready,
      rasterRuntime: {
        configured: raster.configured,
        ready: raster.ready,
        providerId: raster.providerId,
        model: raster.model,
        zeroCostVerified: raster.zeroCostVerified,
        reason: raster.reason,
        paidFallbackEnabled: false,
        secretDelivery: 'server-only',
      },
      modelBasedImageEditing: false,
      persistence: 'client-local-verified-asset-graph',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      selfTest,
    });
  });

  router.post('/api/creative/v1.5/plan', (req, res) => {
    const kinds = sensitiveKinds(req.body);
    if (kinds.length > 0) {
      return res.status(422).json({
        ok: false,
        code: 'SENSITIVE_INPUT_BLOCKED',
        sensitiveKinds: kinds,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
        externalNetworkRequests: 0,
      });
    }

    try {
      const request = parseVisualArtifactRequestV15(req.body);
      const plan = planVisualBrainV15(request);
      return res.status(200).json({
        ok: true,
        plan,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
        externalNetworkRequests: 0,
        providerExecutions: 0,
      });
    } catch (error) {
      if (error instanceof VisualArtifactValidationErrorV15) return safeFailure(res, 400, error.code);
      return safeFailure(res, 422, 'VISUAL_PLAN_FAILED');
    }
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
      const parsedRequest = parseVisualArtifactRequestV15(req.body);
      const plan = planVisualBrainV15(parsedRequest);
      if (!plan.providerPolicy.selectedProviderId) return safeFailure(res, 503, plan.providerPolicy.failClosedReason || 'NO_VERIFIED_ZERO_COST_PROVIDER');
      const artifact = generateVisualArtifactV15(parsedRequest);
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
      const planSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
      res.setHeader('X-Origin-Visual-Brain', plan.version);
      res.setHeader('X-Origin-Visual-Provider', plan.providerPolicy.selectedProviderId);
      res.setHeader('X-Origin-Visual-Typography', plan.typography.strategy);
      res.setHeader('X-Origin-Visual-Quality-Score', String(artifact.quality.score));
      res.setHeader('X-Origin-Visual-Critic', 'deterministic-v1');
      res.setHeader('X-Origin-Visual-Plan-Sha256', planSha256);
      res.setHeader('X-Origin-Visual-Generation-Id', `visual-${artifact.sha256.slice(0, 24)}`);
      return res.status(200).send(artifact.bytes);
    } catch (error) {
      if (error instanceof VisualArtifactValidationErrorV15) return safeFailure(res, 400, error.code);
      return safeFailure(res, 422, 'VISUAL_ARTIFACT_GENERATION_FAILED');
    }
  });

  return router;
}
