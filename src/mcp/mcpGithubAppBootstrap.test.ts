// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  McpGithubAppBootstrap,
  McpGithubAppSecretCipher,
  createReviewedGithubAppManifest,
  type McpGithubAppRegistration,
  type McpGithubAppRegistrationStore,
  type McpGithubManifestPending,
  type McpGithubManifestPendingStore,
} from './mcpGithubAppBootstrap.js';

class PendingStore implements McpGithubManifestPendingStore {
  record: McpGithubManifestPending | undefined;
  async put(record: McpGithubManifestPending) { this.record = structuredClone(record); }
  async consume(record: McpGithubManifestPending) {
    if (!this.record || JSON.stringify(this.record) !== JSON.stringify(record)) return false;
    this.record = undefined;
    return true;
  }
}

class RegistrationStore implements McpGithubAppRegistrationStore {
  record: McpGithubAppRegistration | undefined;
  async get(ownerId: string) { return this.record?.ownerId === ownerId ? structuredClone(this.record) : undefined; }
  async insert(record: McpGithubAppRegistration) {
    if (this.record) return false;
    this.record = structuredClone(record);
    return true;
  }
}

const owner = '11111111-1111-4111-8111-111111111111';
const who = { ownerId: owner, sessionBinding: 's'.repeat(64) };
const origin = 'https://origin.example.com';

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1234,
    slug: 'origin-personal-read-only',
    owner: { login: 'nori72ny' },
    permissions: { metadata: 'read', contents: 'read' },
    events: [],
    client_id: 'Iv1.fixtureclient123',
    client_secret: 'fixture-secret-value-abcdefghijklmnopqrstuvwxyz',
    pem: '-----BEGIN RSA PRIVATE KEY-----\nSHOULD-NOT-BE-STORED\n-----END RSA PRIVATE KEY-----',
    webhook_secret: 'SHOULD-NOT-BE-STORED',
    ...overrides,
  };
}

function setup(responseBody: unknown = fixture()) {
  const pendingStore = new PendingStore();
  const registrationStore = new RegistrationStore();
  const cipher = new McpGithubAppSecretCipher('k1', { k1: randomBytes(32) });
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(responseBody), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  }));
  const bootstrap = new McpGithubAppBootstrap({
    appOrigin: origin,
    expectedOwnerLogin: 'nori72ny',
    pendingStore,
    registrationStore,
    secretCipher: cipher,
    fetchImpl: fetchImpl as typeof fetch,
  });
  return { bootstrap, pendingStore, registrationStore, cipher, fetchImpl };
}

function stateFrom(actionUrl: string) {
  const state = new URL(actionUrl).searchParams.get('state');
  if (!state) throw new Error('missing state');
  return state;
}

describe('GitHub App approval-only bootstrap', () => {
  it('builds only the reviewed private read-only manifest', () => {
    const manifest = createReviewedGithubAppManifest(origin);
    expect(manifest.public).toBe(false);
    expect(manifest.default_permissions).toEqual({ contents: 'read' });
    expect(manifest.default_events).toEqual([]);
    expect(manifest.request_oauth_on_install).toBe(false);
    expect(manifest.hook_attributes.active).toBe(false);
    expect(manifest.redirect_url).toBe('https://origin.example.com/api/mcp/github/app/manifest/callback');
    expect(manifest.callback_urls).toEqual(['https://origin.example.com/api/mcp/oauth/github/callback']);
  });

  it('stores only hashes before redirecting to GitHub', async () => {
    const { bootstrap, pendingStore } = setup();
    const started = await bootstrap.begin(who);
    const state = stateFrom(started.actionUrl);
    expect(started.actionUrl).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=/);
    expect(JSON.parse(started.manifest).default_permissions).toEqual({ contents: 'read' });
    expect(pendingStore.record?.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pendingStore.record?.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(pendingStore.record)).not.toContain(state);
    expect(JSON.stringify(pendingStore.record)).not.toContain(who.sessionBinding);
  });

  it('converts a single-use code, encrypts the client secret and discards PEM/webhook secret', async () => {
    const { bootstrap, registrationStore, cipher, fetchImpl } = setup();
    const started = await bootstrap.begin(who);
    const query = new URLSearchParams({
      code: 'a'.repeat(40),
      state: stateFrom(started.actionUrl),
    });
    const result = await bootstrap.complete(who, query);

    expect(result.registered).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = registrationStore.record!;
    expect(saved.clientSecretCiphertext).not.toContain('fixture-secret-value');
    expect(JSON.stringify(saved)).not.toContain('SHOULD-NOT-BE-STORED');
    expect(cipher.open(saved)).toBe('fixture-secret-value-abcdefghijklmnopqrstuvwxyz');
    expect(saved.registrationFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects callback replay before any second GitHub conversion', async () => {
    const { bootstrap, fetchImpl } = setup();
    const started = await bootstrap.begin(who);
    const query = new URLSearchParams({ code: 'a'.repeat(40), state: stateFrom(started.actionUrl) });
    await bootstrap.complete(who, query);
    await expect(bootstrap.complete(who, query)).rejects.toThrow('MCP_GITHUB_CALLBACK_REJECTED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a different authenticated session for the same owner', async () => {
    const { bootstrap, fetchImpl } = setup();
    const started = await bootstrap.begin(who);
    await expect(bootstrap.complete(
      { ownerId: owner, sessionBinding: 'x'.repeat(64) },
      new URLSearchParams({ code: 'a'.repeat(40), state: stateFrom(started.actionUrl) }),
    )).rejects.toThrow('MCP_GITHUB_CALLBACK_REJECTED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ permissions: { metadata: 'read', contents: 'write' } }, 'MCP_GITHUB_PERMISSION_MISMATCH'],
    [{ permissions: { metadata: 'read', contents: 'read', issues: 'read' } }, 'MCP_GITHUB_PERMISSION_MISMATCH'],
    [{ events: ['push'] }, 'MCP_GITHUB_PERMISSION_MISMATCH'],
    [{ owner: { login: 'attacker' } }, 'MCP_GITHUB_CONVERSION_INVALID'],
  ])('fails closed on broadened or mismatched GitHub response %#', async (change, code) => {
    const { bootstrap, fetchImpl, registrationStore } = setup(fixture(change as Record<string, unknown>));
    const started = await bootstrap.begin(who);
    await expect(bootstrap.complete(
      who,
      new URLSearchParams({ code: 'a'.repeat(40), state: stateFrom(started.actionUrl) }),
    )).rejects.toThrow(code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(registrationStore.record).toBeUndefined();
  });
});
