import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { OriginMcpSession } from './mcpClient.js';

export interface McpServerChoice { id: string; label: string; endpoint: string; zeroCostApproved: true }
export interface McpConnectionRecord {
  id: string; ownerId: string; serverId: string; endpoint: string; credential: string;
  version: number; status: 'registered' | 'verified' | 'failed'; checkedAt: string | null;
}
/** Implementations must enforce owner filtering and the insert limit/CAS atomically in shared durable storage. */
export interface McpConnectionStore {
  list(ownerId: string): Promise<McpConnectionRecord[]>;
  get(ownerId: string, id: string): Promise<McpConnectionRecord | undefined>;
  insert(record: McpConnectionRecord, ownerLimit: number): Promise<boolean>;
  replace(record: McpConnectionRecord, expectedVersion: number): Promise<boolean>;
  remove(ownerId: string, id: string, expectedVersion: number): Promise<boolean>;
}
export class McpManagementError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const reject = (code: string, status: number): never => { throw new McpManagementError(code, status); };
const publicRecord = (record: McpConnectionRecord) => ({ id: record.id, serverId: record.serverId, version: record.version, status: record.status, checkedAt: record.checkedAt });
function aad(record: Pick<McpConnectionRecord, 'id' | 'ownerId' | 'serverId' | 'endpoint'>): Buffer {
  return Buffer.from(JSON.stringify(['origin-mcp-v1', record.ownerId, record.id, record.serverId, record.endpoint]));
}
export function sealMcpCredential(token: string, record: Parameters<typeof aad>[0], key: Buffer): string {
  if (key.length !== 32 || !token || Buffer.byteLength(token) > 8192 || /[\r\n]/.test(token)) return reject('MCP_CREDENTIAL_INVALID', 409);
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad(record));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function openMcpCredential(record: McpConnectionRecord, key: Buffer): string {
  try {
    const [version, nonce, tag, value, extra] = record.credential.split('.');
    if (key.length !== 32 || version !== 'v1' || extra !== undefined || !value) throw new Error();
    const iv = Buffer.from(nonce, 'base64'); const authTag = Buffer.from(tag, 'base64');
    if (iv.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad(record)); decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
  } catch { return reject('MCP_CREDENTIAL_UNAVAILABLE', 503); }
}

export class McpConnectionService {
  private readonly servers: readonly McpServerChoice[];
  private readonly key: Buffer;
  constructor(private readonly options: {
    servers: readonly McpServerChoice[];
    key: Buffer;
    store: McpConnectionStore;
    /** Trusted credential broker: credentials are obtained server-side for this owner. */
    resolveCredential: (ownerId: string, serverId: string) => Promise<string | undefined>;
    /** Must return an owner-scoped session with NO tool grants and the guarded transport. */
    createProbe: (ownerId: string, server: McpServerChoice, token: string) => Pick<OriginMcpSession, 'connect' | 'catalog' | 'close'>;
  }) {
    if (options.key.length !== 32 || options.servers.length > 20 || new Set(options.servers.map(s => s.id)).size !== options.servers.length) reject('MCP_MANAGEMENT_CONFIG_INVALID', 503);
    for (const server of options.servers) {
      const url = new URL(server.endpoint);
      if (!/^[A-Za-z0-9-]{1,64}$/.test(server.id) || !server.label || server.label.length > 80 || server.zeroCostApproved !== true || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) reject('MCP_MANAGEMENT_CONFIG_INVALID', 503);
    }
    this.servers = structuredClone(options.servers); this.key = Buffer.from(options.key);
  }
  private async owned(ownerId: string, id: string, version: number) {
    const record = await this.options.store.get(ownerId, id);
    if (!record || record.ownerId !== ownerId || record.id !== id) return reject('MCP_CONNECTION_NOT_FOUND', 404);
    if (record.version !== version) return reject('MCP_CONNECTION_CHANGED', 409);
    return record;
  }
  async overview(ownerId: string) {
    const records = await this.options.store.list(ownerId);
    if (records.some(record => record.ownerId !== ownerId)) return reject('MCP_STORE_SCOPE_INVALID', 503);
    return { servers: this.servers.map(({ id, label }) => ({ id, label })), connections: records.map(publicRecord) };
  }
  async register(ownerId: string, serverId: string) {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) return reject('MCP_SERVER_NOT_ALLOWED', 400);
    const token = await this.options.resolveCredential(ownerId, serverId);
    if (!token) return reject('MCP_CREDENTIAL_NOT_LINKED', 409);
    const record: McpConnectionRecord = { id: randomUUID(), ownerId, serverId, endpoint: server.endpoint, credential: '', version: 1, status: 'registered', checkedAt: null };
    record.credential = sealMcpCredential(token, record, this.key);
    if (!await this.options.store.insert(record, 20)) return reject('MCP_CONNECTION_LIMIT_OR_DUPLICATE', 409);
    return publicRecord(record);
  }
  async probe(ownerId: string, id: string, version: number) {
    const record = await this.owned(ownerId, id, version);
    const server = this.servers.find(s => s.id === record.serverId && s.endpoint === record.endpoint);
    if (!server) return reject('MCP_SERVER_NOT_ALLOWED', 409);
    const session = this.options.createProbe(ownerId, structuredClone(server), openMcpCredential(record, this.key));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let verified = false; let toolCount = 0;
    try {
      await Promise.race([session.connect(), new Promise<never>((_, rejectTimeout) => { timer = setTimeout(() => rejectTimeout(new Error('timeout')), 20_000); })]);
      toolCount = session.catalog().length; verified = true;
    } catch { verified = false; }
    finally { clearTimeout(timer); await session.close(); }
    const next = { ...record, version: version + 1, status: verified ? 'verified' as const : 'failed' as const, checkedAt: new Date().toISOString() };
    if (!await this.options.store.replace(next, version)) return reject('MCP_CONNECTION_CHANGED', 409);
    return { connection: publicRecord(next), toolCount: verified ? toolCount : 0, verified };
  }
  async remove(ownerId: string, id: string, version: number) {
    await this.owned(ownerId, id, version);
    if (!await this.options.store.remove(ownerId, id, version)) return reject('MCP_CONNECTION_CHANGED', 409);
  }
}
