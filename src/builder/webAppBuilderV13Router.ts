import { Router, type Response } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import { generateWebProjectV13, runWebBuilderV13SelfTest } from './webAppBuilderV13.js';

function sensitiveKinds(body: unknown): string[] {
  let serialized = '';
  try { serialized = JSON.stringify(body ?? {}); } catch { return ['unserializable_input']; }
  return detectSensitiveConversation([{ role: 'user', content: serialized }]);
}

function safeFailure(res: Response, status: number, code: string) {
  return res.status(status).json({ ok: false, code, freeOnly: true, costUsd: 0, paidFallbackUsed: false });
}

export function createWebAppBuilderV13Router() {
  const router = Router();

  router.get('/api/builder/v1.3/status', (_req, res) => {
    const builderSelfTest = runWebBuilderV13SelfTest();
    const ready = Object.values(builderSelfTest).every(Boolean);
    return res.status(ready ? 200 : 503).json({
      ok: true,
      ready,
      version: '1.3',
      capability: 'verified-web-application-builder',
      projectKinds: ['landing', 'dashboard', 'webapp'],
      output: 'static-project-zip',
      builderSelfTest,
      verification: ['package-structure', 'strict-csp', 'offline-runtime', 'zero-cost-contract'],
      publication: 'verified-bundle-handoff',
      automaticPublishing: false,
      persistence: 'client-save-only',
      externalRuntimeDependencies: 0,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });
  });

  router.post('/api/builder/v1.3/inspect', (req, res) => {
    const kinds = sensitiveKinds(req.body);
    if (kinds.length > 0) return res.status(422).json({
      ok: false,
      code: 'SENSITIVE_INPUT_BLOCKED',
      message: 'Potentially sensitive input was detected, so ORIGIN did not build or persist the web project.',
      sensitiveKinds: kinds,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    });
    try {
      const project = generateWebProjectV13(req.body);
      if (!project.verified) return safeFailure(res, 422, 'WEB_PROJECT_VERIFICATION_FAILED');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        ok: true,
        filename: project.filename,
        sha256: project.sha256,
        verified: project.verified,
        verification: project.verification,
        manifest: project.manifest,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    } catch {
      return safeFailure(res, 400, 'INVALID_WEB_BUILDER_SPEC');
    }
  });

  router.post('/api/builder/v1.3/generate', (req, res) => {
    const kinds = sensitiveKinds(req.body);
    if (kinds.length > 0) return res.status(422).json({
      ok: false,
      code: 'SENSITIVE_INPUT_BLOCKED',
      message: 'Potentially sensitive input was detected, so ORIGIN did not build or persist the web project.',
      sensitiveKinds: kinds,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    });
    try {
      const project = generateWebProjectV13(req.body);
      if (!project.verified) return safeFailure(res, 422, 'WEB_PROJECT_VERIFICATION_FAILED');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', project.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${project.filename.replace(/"/g, '')}"`);
      res.setHeader('X-Origin-Project-Sha256', project.sha256);
      res.setHeader('X-Origin-Project-Verified', 'true');
      res.setHeader('X-Origin-Free-Only', 'true');
      res.setHeader('X-Origin-Cost-Usd', '0');
      res.setHeader('X-Origin-Paid-Fallback', 'false');
      return res.status(200).send(project.bytes);
    } catch {
      return safeFailure(res, 400, 'INVALID_WEB_BUILDER_SPEC');
    }
  });

  return router;
}
