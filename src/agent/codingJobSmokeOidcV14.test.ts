// @vitest-environment node
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CODING_SMOKE_OIDC_AUDIENCE_V14,
  CODING_SMOKE_OIDC_ISSUER_V14,
  CODING_SMOKE_WORKFLOW_NAME_V14,
  CODING_SMOKE_WORKFLOW_REF_V14,
  verifyCodingJobSmokeOidcV14,
} from './codingJobSmokeOidcV14.js';

const nowMs = Date.UTC(2026, 8, 12, 12, 0, 0);
const nowSeconds = Math.floor(nowMs / 1_000);
const sha = '9'.repeat(40);

function tokenFixture(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${randomUUID()}`;
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = {
    iss: CODING_SMOKE_OIDC_ISSUER_V14,
    aud: CODING_SMOKE_OIDC_AUDIENCE_V14,
    sub: 'repo:nori72ny/myAIspecials:ref:refs/heads/main',
    repository: 'nori72ny/myAIspecials',
    repository_id: '1282163675',
    repository_owner: 'nori72ny',
    repository_visibility: 'public',
    ref: 'refs/heads/main',
    ref_type: 'branch',
    event_name: 'push',
    runner_environment: 'github-hosted',
    workflow: CODING_SMOKE_WORKFLOW_NAME_V14,
    workflow_ref: CODING_SMOKE_WORKFLOW_REF_V14,
    sha,
    workflow_sha: sha,
    run_id: '34699999999',
    jti: randomUUID(),
    iat: nowSeconds - 10,
    nbf: nowSeconds - 10,
    exp: nowSeconds + 300,
    ...overrides,
  };
  const headerText = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadText = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerText}.${payloadText}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), privateKey).toString('base64url');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...publicJwk, kid, use: 'sig', alg: 'RS256' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  return { token: `${signingInput}.${signature}`, fetchImpl };
}

describe('V1.4 GitHub OIDC production smoke verifier', () => {
  it('accepts only a correctly signed exact-repository main push token', async () => {
    const { token, fetchImpl } = tokenFixture();
    const verified = await verifyCodingJobSmokeOidcV14(token, { fetchImpl, nowMs });
    expect(verified).toEqual({ sha, runId: '34699999999' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects the wrong audience before any JWKS request', async () => {
    const { token, fetchImpl } = tokenFixture({ aud: 'other-audience' });
    await expect(verifyCodingJobSmokeOidcV14(token, { fetchImpl, nowMs })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a different workflow before any JWKS request', async () => {
    const { token, fetchImpl } = tokenFixture({ workflow_ref: 'nori72ny/myAIspecials/.github/workflows/other.yml@refs/heads/main' });
    await expect(verifyCodingJobSmokeOidcV14(token, { fetchImpl, nowMs })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects expired tokens before any JWKS request', async () => {
    const { token, fetchImpl } = tokenFixture({ iat: nowSeconds - 900, nbf: nowSeconds - 900, exp: nowSeconds - 120 });
    await expect(verifyCodingJobSmokeOidcV14(token, { fetchImpl, nowMs })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a bad signature without exposing token contents', async () => {
    const { token, fetchImpl } = tokenFixture();
    const parts = token.split('.');
    const corruptedSignature = `${parts[2].slice(0, -2)}aa`;
    await expect(verifyCodingJobSmokeOidcV14(`${parts[0]}.${parts[1]}.${corruptedSignature}`, { fetchImpl, nowMs })).resolves.toBeNull();
  });
});
