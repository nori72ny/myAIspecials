// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeChatFileArtifactBytes,
  downloadChatFileArtifact,
  filterVerifiedChatFileArtifacts,
  parseChatFileArtifacts,
  verifyChatFileArtifactDigest,
  type ChatFileArtifact,
} from './chatArtifacts';

/** ZIP 署名＋ pptx パッケージマーカーを含む最小バイト列（実ZIPである必要はない）。 */
function pptxBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('ppt/presentation.xml', 'utf8'),
    Buffer.from('deck-contents', 'utf8'),
  ]);
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validPptxArtifact(overrides: Record<string, unknown> = {}): ChatFileArtifact {
  const bytes = pptxBytes();
  const sha256 = sha256Hex(bytes);
  return {
    id: `artifact-pptx-${sha256.slice(0, 20)}`,
    kind: 'presentation',
    artifactType: 'pptx',
    filename: 'proposal-deck.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sha256,
    byteLength: bytes.length,
    encoding: 'base64',
    data: bytes.toString('base64'),
    verified: true,
    verification: ['non-empty', 'zip-signature', 'pptx-package'],
    freeOnly: true,
    costUsd: 0,
    paidFallbackUsed: false,
    ...overrides,
  } as ChatFileArtifact;
}

describe('parseChatFileArtifacts', () => {
  it('accepts a well-formed pptx payload', () => {
    const artifact = validPptxArtifact();
    const parsed = parseChatFileArtifacts([artifact]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].filename).toBe('proposal-deck.pptx');
    expect(parsed[0].artifactType).toBe('pptx');
    expect(parsed[0].sha256).toBe(artifact.sha256);
  });

  it('returns an empty list for undefined, non-array, and oversized inputs', () => {
    const artifact = validPptxArtifact();
    expect(parseChatFileArtifacts(undefined)).toEqual([]);
    expect(parseChatFileArtifacts('not-an-array')).toEqual([]);
    expect(parseChatFileArtifacts([artifact, artifact, artifact, artifact])).toEqual([]);
  });

  it('silently drops artifacts with malformed fields and keeps the valid ones', () => {
    const valid = validPptxArtifact();
    const malformed: unknown[] = [
      { ...validPptxArtifact(), id: 'deck-1' },
      { ...validPptxArtifact(), kind: 'document' },
      { ...validPptxArtifact(), mimeType: 'application/pdf' },
      { ...validPptxArtifact(), filename: 'nested/proposal-deck.pptx' },
      { ...validPptxArtifact(), filename: 'proposal-deck.pdf' },
      { ...validPptxArtifact(), sha256: 'not-a-digest' },
      { ...validPptxArtifact(), byteLength: 1_500_001 },
      { ...validPptxArtifact(), encoding: 'utf8' },
      { ...validPptxArtifact(), data: '!!!not-base64!!!' },
      { ...validPptxArtifact(), verified: false },
      { ...validPptxArtifact(), verification: [] },
      { ...validPptxArtifact(), freeOnly: false },
      { ...validPptxArtifact(), costUsd: 0.01 },
      { ...validPptxArtifact(), paidFallbackUsed: true },
      { ...validPptxArtifact(), artifactType: 'pdf' },
      null,
      'junk',
    ];
    for (const entry of malformed) {
      expect(parseChatFileArtifacts([entry])).toEqual([]);
      expect(parseChatFileArtifacts([valid, entry])).toEqual([valid]);
    }
  });

  it('drops payloads whose bytes are not a matching package', () => {
    // ZIP 署名はあるが pptx のパッケージマーカーが無い
    const noMarkerBytes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('word/document.xml', 'utf8'),
    ]);
    const noMarker = validPptxArtifact({
      byteLength: noMarkerBytes.length,
      data: noMarkerBytes.toString('base64'),
      sha256: sha256Hex(noMarkerBytes),
    });
    expect(parseChatFileArtifacts([noMarker])).toEqual([]);

    // byteLength が実際のバイト数と一致しない
    const wrongLength = validPptxArtifact({ byteLength: pptxBytes().length + 1 });
    expect(parseChatFileArtifacts([wrongLength])).toEqual([]);

    // ZIP 署名が無い
    const noSignatureBytes = Buffer.from('ppt/presentation.xml', 'utf8');
    const noSignature = validPptxArtifact({
      byteLength: noSignatureBytes.length,
      data: noSignatureBytes.toString('base64'),
      sha256: sha256Hex(noSignatureBytes),
    });
    expect(parseChatFileArtifacts([noSignature])).toEqual([]);
  });
});

describe('digest verification', () => {
  it('accepts a digest that matches the decoded bytes', async () => {
    const artifact = validPptxArtifact();
    await expect(verifyChatFileArtifactDigest(artifact)).resolves.toBe(true);
    await expect(filterVerifiedChatFileArtifacts([artifact])).resolves.toEqual([artifact]);
  });

  it('excludes an artifact whose sha256 does not match its bytes', async () => {
    const otherDigest = sha256Hex(Buffer.from('different-bytes', 'utf8'));
    const tampered = validPptxArtifact({ sha256: otherDigest });
    // 形式検証（parse）は申告値の形式しか見ないため通るが、
    // 実在照合（digest）で除外される。
    expect(parseChatFileArtifacts([tampered])).toHaveLength(1);
    await expect(verifyChatFileArtifactDigest(tampered)).resolves.toBe(false);
    await expect(filterVerifiedChatFileArtifacts([tampered])).resolves.toEqual([]);
    const valid = validPptxArtifact();
    await expect(filterVerifiedChatFileArtifacts([tampered, valid])).resolves.toEqual([valid]);
  });
});

describe('downloadChatFileArtifact', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads after re-verifying the digest', async () => {
    const artifact = validPptxArtifact();
    const bytes = decodeChatFileArtifactBytes(artifact);
    expect(bytes).not.toBeNull();
    const createObjectURL = vi.fn(() => 'blob:chat-artifact');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(downloadChatFileArtifact(artifact)).resolves.toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('refuses to download when the digest does not match', async () => {
    const tampered = validPptxArtifact({ sha256: sha256Hex(Buffer.from('other', 'utf8')) });
    const createObjectURL = vi.fn(() => 'blob:chat-artifact');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(downloadChatFileArtifact(tampered)).resolves.toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
