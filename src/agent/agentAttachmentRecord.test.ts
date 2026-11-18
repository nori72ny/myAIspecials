// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  agentAttachmentsEnabled,
  computeAgentAttachmentSetDigest,
  normalizeAgentAttachmentFileName,
  normalizeAgentAttachmentMediaType,
  resolveAgentAttachmentKind,
  validateAddAgentAttachmentFileInput,
  validateAgentAttachmentFileText,
  validateCreateAgentAttachmentSetInput,
  MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS,
  type AgentAttachmentFileMeta,
} from './agentAttachmentRecord.js';
import {
  attachmentUploadTokenDigest,
  issueAttachmentUploadCapability,
  verifyAttachmentUploadCapability,
} from './agentAttachmentCapability.js';

const SECRET = 'test-only-'.repeat(5);
const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };
const setId = 'att-12345678-abcd-4ef0-9abc-def012345678';
const ownerBinding = 'a'.repeat(64);
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('agent attachments switch', () => {
  it('is enabled only by the exact string "true"', () => {
    expect(agentAttachmentsEnabled({ ORIGIN_AGENT_ATTACHMENTS_ENABLED: 'true' })).toBe(true);
    expect(agentAttachmentsEnabled({ ORIGIN_AGENT_ATTACHMENTS_ENABLED: 'TRUE' })).toBe(false);
    expect(agentAttachmentsEnabled({ ORIGIN_AGENT_ATTACHMENTS_ENABLED: '1' })).toBe(false);
    expect(agentAttachmentsEnabled({})).toBe(false);
  });
});

describe('attachment file name normalization', () => {
  it('trims and accepts ordinary names', () => {
    expect(normalizeAgentAttachmentFileName('  report.csv ')).toBe('report.csv');
    expect(normalizeAgentAttachmentFileName('監査メモ.md')).toBe('監査メモ.md');
  });

  it('rejects empty, overlong, path-bearing and control-character names', () => {
    expect(() => normalizeAgentAttachmentFileName('')).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => normalizeAgentAttachmentFileName('   ')).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => normalizeAgentAttachmentFileName('a'.repeat(256))).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => normalizeAgentAttachmentFileName('dir/file.txt')).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => normalizeAgentAttachmentFileName('dir\\file.txt')).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => normalizeAgentAttachmentFileName('bad\nname.txt')).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => normalizeAgentAttachmentFileName(42)).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
  });
});

describe('attachment kind resolution (stage 1: text family only)', () => {
  it('accepts text extensions, including tsv which the chat list lacks', () => {
    for (const name of ['a.txt', 'a.csv', 'a.tsv', 'a.md', 'a.json', 'A.CSV']) {
      expect(resolveAgentAttachmentKind(name, undefined)).toBe('text');
    }
  });

  it('accepts text/* media types and application/json', () => {
    expect(resolveAgentAttachmentKind('data', 'text/plain')).toBe('text');
    expect(resolveAgentAttachmentKind('data', 'text/tab-separated-values')).toBe('text');
    expect(resolveAgentAttachmentKind('data', 'application/json')).toBe('text');
  });

  it('rejects binaries and the stage-2 kinds for now', () => {
    expect(resolveAgentAttachmentKind('a.bin', 'application/octet-stream')).toBeNull();
    expect(resolveAgentAttachmentKind('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBeNull();
    expect(resolveAgentAttachmentKind('a.pdf', 'application/pdf')).toBeNull();
    expect(resolveAgentAttachmentKind('a.png', 'image/png')).toBeNull();
  });

  it('derives a media type from the extension when the presented one is unusable', () => {
    expect(normalizeAgentAttachmentMediaType('a.csv', undefined)).toBe('text/csv');
    expect(normalizeAgentAttachmentMediaType('a.tsv', '')).toBe('text/tab-separated-values');
    expect(normalizeAgentAttachmentMediaType('a.json', 'not a media type')).toBe('application/json');
    expect(normalizeAgentAttachmentMediaType('a.txt', 'TEXT/PLAIN')).toBe('text/plain');
  });
});

describe('attachment file text validation', () => {
  it('measures bytes, chars and digest from the text itself', () => {
    const measured = validateAgentAttachmentFileText('hello');
    expect(measured).toEqual({ byteSize: 5, charCount: 5, sha256: sha256('hello') });
    const japanese = validateAgentAttachmentFileText('監査');
    expect(japanese.charCount).toBe(2);
    expect(japanese.byteSize).toBe(6);
  });

  it('rejects oversize instead of truncating', () => {
    expect(() => validateAgentAttachmentFileText('a'.repeat(MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS + 1)))
      .toThrow('AGENT_ATTACHMENT_FILE_TOO_LARGE');
    expect(validateAgentAttachmentFileText('a'.repeat(MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS)).charCount)
      .toBe(MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS);
  });

  it('rejects likely secrets with the dedicated code', () => {
    expect(() => validateAgentAttachmentFileText('config: api_key = "sk-test-123"'))
      .toThrow('AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED');
    expect(() => validateAgentAttachmentFileText('-----BEGIN PRIVATE KEY-----'))
      .toThrow('AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED');
  });

  it('rejects non-string bodies', () => {
    expect(() => validateAgentAttachmentFileText(undefined)).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => validateAgentAttachmentFileText({ text: 'x' })).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
  });
});

describe('attachment set digest', () => {
  const meta = (name: string, text: string): AgentAttachmentFileMeta => ({
    idx: 0,
    name,
    mediaType: 'text/plain',
    kind: 'text',
    byteSize: Buffer.byteLength(text, 'utf8'),
    charCount: text.length,
    sha256: sha256(text),
    extractionStatus: 'ok',
  });

  it('is independent of upload order and sensitive to content changes', () => {
    const a = meta('a.csv', 'alpha');
    const b = meta('b.csv', 'beta');
    expect(computeAgentAttachmentSetDigest([a, b])).toBe(computeAgentAttachmentSetDigest([b, a]));
    expect(computeAgentAttachmentSetDigest([a, b])).not.toBe(computeAgentAttachmentSetDigest([a, meta('b.csv', 'gamma')]));
    expect(computeAgentAttachmentSetDigest([a])).not.toBe(computeAgentAttachmentSetDigest([a, b]));
    expect(computeAgentAttachmentSetDigest([meta('a.csv', 'alpha')])).not.toBe(computeAgentAttachmentSetDigest([meta('renamed.csv', 'alpha')]));
  });

  it('digests the empty set as the empty string digest', () => {
    expect(computeAgentAttachmentSetDigest([])).toBe(sha256(''));
  });
});

describe('store boundary validation', () => {
  it('validates set creation inputs and expiry bounds', () => {
    const now = Date.now();
    const input = { setId, ownerBinding, uploadTokenDigest: sha256('token'), expiresAt: now + 60_000 };
    expect(validateCreateAgentAttachmentSetInput(input, now)).toEqual(input);
    expect(() => validateCreateAgentAttachmentSetInput({ ...input, setId: 'set-1' }, now)).toThrow('AGENT_ATTACHMENT_SET_ID_INVALID');
    expect(() => validateCreateAgentAttachmentSetInput({ ...input, ownerBinding: 'raw-name' }, now)).toThrow('AGENT_ATTACHMENT_OWNER_BINDING_INVALID');
    expect(() => validateCreateAgentAttachmentSetInput({ ...input, uploadTokenDigest: 'x' }, now)).toThrow('AGENT_ATTACHMENT_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentAttachmentSetInput({ ...input, expiresAt: now - 1 }, now)).toThrow('AGENT_ATTACHMENT_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentAttachmentSetInput({ ...input, expiresAt: now + 30 * 24 * 60 * 60 * 1000 }, now)).toThrow('AGENT_ATTACHMENT_CREATE_INPUT_INVALID');
  });

  it('recomputes file measurements and rejects metadata that disagrees with the body', () => {
    const text = 'a,b\n1,2\n';
    const measured = validateAgentAttachmentFileText(text);
    const input = { name: 'a.csv', mediaType: 'text/csv', kind: 'text' as const, ...measured, extractedText: text };
    expect(validateAddAgentAttachmentFileInput(input)).toEqual(input);
    expect(() => validateAddAgentAttachmentFileInput({ ...input, sha256: sha256('other') })).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => validateAddAgentAttachmentFileInput({ ...input, charCount: 1 })).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
    expect(() => validateAddAgentAttachmentFileInput({ ...input, kind: 'exe' as never })).toThrow('AGENT_ATTACHMENT_FILE_INVALID');
  });
});

describe('attachment upload capability', () => {
  it('issues and verifies a token bound to one set', () => {
    const now = Date.now();
    const issued = issueAttachmentUploadCapability(setId, env, now);
    expect(issued.expiresAt).toBe(now + 24 * 60 * 60 * 1000);
    const payload = verifyAttachmentUploadCapability(issued.token, env, now);
    expect(payload?.setId).toBe(setId);
    expect(payload?.kind).toBe('attachment-upload');
    expect(attachmentUploadTokenDigest(issued.token)).toBe(sha256(issued.token));
  });

  it('rejects tampered, foreign-secret and expired tokens', () => {
    const now = Date.now();
    const issued = issueAttachmentUploadCapability(setId, env, now);
    const [encoded, signature] = issued.token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ v: 1, kind: 'attachment-upload', setId: 'att-99999999-abcd-4ef0-9abc-def012345678', iat: now, exp: now + 60_000 }), 'utf8').toString('base64url');
    expect(verifyAttachmentUploadCapability(`${tamperedPayload}.${signature}`, env, now)).toBeNull();
    expect(verifyAttachmentUploadCapability(`${encoded}.${signature}x`, env, now)).toBeNull();
    expect(verifyAttachmentUploadCapability(issued.token, { ORIGIN_AGENT_APPROVAL_SECRET: 'other-'.repeat(8) }, now)).toBeNull();
    expect(verifyAttachmentUploadCapability(issued.token, env, now + 24 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(verifyAttachmentUploadCapability('not-a-token', env, now)).toBeNull();
    expect(verifyAttachmentUploadCapability('', env, now)).toBeNull();
  });

  it('fails closed when the signing secret is not configured', () => {
    expect(() => issueAttachmentUploadCapability(setId, {}, Date.now())).toThrow('AGENT_APPROVAL_NOT_CONFIGURED');
    expect(() => issueAttachmentUploadCapability('bad-id', env, Date.now())).toThrow('AGENT_ATTACHMENT_SET_ID_INVALID');
    expect(verifyAttachmentUploadCapability('a.b', {}, Date.now())).toBeNull();
  });
});
