import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const OWNER = /^[A-Za-z0-9:_-]{1,192}$/;
const SESSION = /^.{32,8192}$/s;
const SLUG = /^[A-Za-z0-9-]{1,100}$/;
const CLIENT_ID = /^[A-Za-z0-9._-]{1,256}$/;
const CODE = /^[A-Za-z0-9_-]{20,256}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export type McpGithubManifestPending = {
  ownerId: string;
  stateHash: string;
  sessionHash: string;
  manifestHash: string;
};

export interface McpGithubManifestPendingStore {
  put(record: McpGithubManifestPending): Promise<void>;
  consume(record: McpGithubManifestPending): Promise<boolean>;
}

export type McpGithubAppRegistration = {
  ownerId: string;
  appId: number;
  appSlug: string;
  clientId: string;
  clientSecretCiphertext: string;
  registrationFingerprint: string;
  version: number;
  status: 'registered' | 'revoked';
};

export interface McpGithubAppRegistrationStore {
  get(ownerId: string): Promise<McpGithubAppRegistration | undefined>;
  insert(record: McpGithubAppRegistration): Promise<boolean>;
}

export class McpGithubAppSecretCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;
  constructor(private readonly activeKeyId: string, keys: Readonly<Record<string, Buffer>>) {
    this.keys = new Map(Object.entries(keys).map(([id, key]) => [id, Buffer.from(key)]));
    if (!KEY_ID.test(activeKeyId) || !this.keys.has(activeKeyId) || this.keys.size < 1 || this.keys.size > 5
      || [...this.keys].some(([id, key]) => !KEY_ID.test(id) || key.length !== 32)) throw new Error('MCP_GITHUB_KEY_CONFIG_INVALID');
  }
  private aad(ownerId: string, clientId: string, keyId: string) {
    return Buffer.from(JSON.stringify(['origin-mcp-github-app-secret-v1', keyId, ownerId, clientId]));
  }
  seal(ownerId: string, clientId: string, secret: string): string {
    if (!OWNER.test(ownerId) || !CLIENT_ID.test(clientId) || !/^[\x21-\x7e]{20,2048}$/.test(secret)) throw new Error('MCP_GITHUB_SECRET_INVALID');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, nonce);
    cipher.setAAD(this.aad(ownerId, clientId, this.activeKeyId));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return ['v1', this.activeKeyId, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }
  open(record: McpGithubAppRegistration): string {
    try {
      if (!OWNER.test(record.ownerId) || !CLIENT_ID.test(record.clientId)
        || !/^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(record.clientSecretCiphertext)) throw new Error();
      const [, keyId, nonce, tag, payload] = record.clientSecretCiphertext.split('.');
      const key = this.keys.get(keyId);
      if (!key) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
      decipher.setAAD(this.aad(record.ownerId, record.clientId, keyId));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const secret = Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
      if (!/^[\x21-\x7e]{20,2048}$/.test(secret)) throw new Error();
      return secret;
    } catch { throw new Error('MCP_GITHUB_CREDENTIAL_UNAVAILABLE'); }
  }
}

export type McpGithubBootstrapIdentity = { ownerId: string; sessionBinding: string };

export type McpGithubManifest = {
  name: string;
  url: string;
  hook_attributes: { url: string; active: false };
  redirect_url: string;
  callback_urls: string[];
  description: string;
  public: false;
  default_events: [];
  default_permissions: { contents: 'read' };
  request_oauth_on_install: false;
};

export function createReviewedGithubAppManifest(appOrigin: string): McpGithubManifest {
  const origin = new URL(appOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== appOrigin || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('MCP_GITHUB_CONFIG_INVALID');
  }
  return {
    name: 'ORIGIN Personal Read Only',
    url: appOrigin,
    hook_attributes: { url: new URL('/api/mcp/github/webhook-disabled', appOrigin).href, active: false },
    redirect_url: new URL('/api/mcp/github/app/manifest/callback', appOrigin).href,
    callback_urls: [new URL('/api/mcp/oauth/github/callback', appOrigin).href],
    description: 'Owner-approved read-only GitHub repository connection for ORIGIN Personal.',
    public: false,
    default_events: [],
    default_permissions: { contents: 'read' },
    request_oauth_on_install: false,
  };
}

type GithubConversion = {
  id?: unknown;
  slug?: unknown;
  owner?: { login?: unknown };
  permissions?: unknown;
  events?: unknown;
  client_id?: unknown;
  client_secret?: unknown;
  pem?: unknown;
  webhook_secret?: unknown;
};

function safeConversion(value: unknown, expectedOwnerLogin: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP_GITHUB_CONVERSION_INVALID');
  const input = value as GithubConversion;
  if (!Number.isSafeInteger(input.id) || Number(input.id) < 1 || typeof input.slug !== 'string' || !SLUG.test(input.slug)
    || typeof input.owner?.login !== 'string' || input.owner.login.toLowerCase() !== expectedOwnerLogin.toLowerCase()
    || typeof input.client_id !== 'string' || !CLIENT_ID.test(input.client_id)
    || typeof input.client_secret !== 'string' || !/^[\x21-\x7e]{20,2048}$/.test(input.client_secret)
    || !input.permissions || typeof input.permissions !== 'object' || Array.isArray(input.permissions)
    || !Array.isArray(input.events)) throw new Error('MCP_GITHUB_CONVERSION_INVALID');
  const permissions = input.permissions as Record<string, unknown>;
  const permissionKeys = Object.keys(permissions).sort();
  if (permissions.contents !== 'read' || permissionKeys.some(key => !['contents', 'metadata'].includes(key))
    || permissions.metadata !== undefined && permissions.metadata !== 'read'
    || input.events.length !== 0) throw new Error('MCP_GITHUB_PERMISSION_MISMATCH');
  return {
    appId: Number(input.id),
    appSlug: input.slug,
    ownerLogin: input.owner.login,
    clientId: input.client_id,
    clientSecret: input.client_secret,
    permissions: Object.fromEntries(permissionKeys.map(key => [key, permissions[key]])),
  };
}

export class McpGithubAppBootstrap {
  constructor(private readonly options: {
    appOrigin: string;
    expectedOwnerLogin: string;
    pendingStore: McpGithubManifestPendingStore;
    registrationStore: McpGithubAppRegistrationStore;
    secretCipher: McpGithubAppSecretCipher;
    fetchImpl?: typeof fetch;
    now?: () => number;
  }) {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(options.expectedOwnerLogin)) throw new Error('MCP_GITHUB_CONFIG_INVALID');
    createReviewedGithubAppManifest(options.appOrigin);
  }

  private identity(who: McpGithubBootstrapIdentity) {
    if (!OWNER.test(who.ownerId) || !SESSION.test(who.sessionBinding)) throw new Error('MCP_GITHUB_AUTH_INVALID');
    return who;
  }

  async begin(who: McpGithubBootstrapIdentity) {
    this.identity(who);
    if (await this.options.registrationStore.get(who.ownerId)) throw new Error('MCP_GITHUB_APP_ALREADY_REGISTERED');
    const manifest = createReviewedGithubAppManifest(this.options.appOrigin);
    const manifestJson = JSON.stringify(manifest);
    const state = randomBytes(32).toString('base64url');
    await this.options.pendingStore.put({
      ownerId: who.ownerId,
      stateHash: sha256(state),
      sessionHash: sha256(who.sessionBinding),
      manifestHash: sha256(manifestJson),
    });
    const actionUrl = new URL('https://github.com/settings/apps/new');
    actionUrl.searchParams.set('state', state);
    return { actionUrl: actionUrl.href, manifest: manifestJson };
  }

  async complete(who: McpGithubBootstrapIdentity, query: URLSearchParams) {
    this.identity(who);
    if ([...query.keys()].some(key => !['code', 'state'].includes(key))) throw new Error('MCP_GITHUB_CALLBACK_INVALID');
    const code = query.get('code') ?? '';
    const state = query.get('state') ?? '';
    if (!CODE.test(code) || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new Error('MCP_GITHUB_CALLBACK_INVALID');
    const manifestJson = JSON.stringify(createReviewedGithubAppManifest(this.options.appOrigin));
    const consumed = await this.options.pendingStore.consume({
      ownerId: who.ownerId,
      stateHash: sha256(state),
      sessionHash: sha256(who.sessionBinding),
      manifestHash: sha256(manifestJson),
    });
    if (!consumed) throw new Error('MCP_GITHUB_CALLBACK_REJECTED');
    if (await this.options.registrationStore.get(who.ownerId)) throw new Error('MCP_GITHUB_APP_ALREADY_REGISTERED');

    const response = await (this.options.fetchImpl ?? fetch)(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'ORIGIN-Personal-MCP',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status !== 201) throw new Error('MCP_GITHUB_CONVERSION_FAILED');
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('MCP_GITHUB_CONVERSION_INVALID');
    const converted = safeConversion(JSON.parse(raw), this.options.expectedOwnerLogin);
    const registrationFingerprint = sha256(JSON.stringify([
      converted.appId,
      converted.appSlug,
      converted.ownerLogin.toLowerCase(),
      converted.clientId,
      converted.permissions,
    ]));
    const registration: McpGithubAppRegistration = {
      ownerId: who.ownerId,
      appId: converted.appId,
      appSlug: converted.appSlug,
      clientId: converted.clientId,
      clientSecretCiphertext: this.options.secretCipher.seal(who.ownerId, converted.clientId, converted.clientSecret),
      registrationFingerprint,
      version: 1,
      status: 'registered',
    };
    if (!await this.options.registrationStore.insert(registration)) throw new Error('MCP_GITHUB_APP_ALREADY_REGISTERED');
    return {
      registered: true as const,
      appId: registration.appId,
      appSlug: registration.appSlug,
      clientId: registration.clientId,
      registrationFingerprint,
    };
  }
}
