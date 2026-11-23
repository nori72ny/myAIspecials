// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';

describe('verifyAndSelfFixArtifact binary deliverable envelopes (R-2)', () => {
  it('returns a base64-carrying document envelope byte-for-byte, past the textual cap', async () => {
    const entity = Buffer.alloc(150_000, 0x5a);
    const envelope = JSON.stringify({
      kind: 'document',
      format: 'xlsx',
      filename: 'capital.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: entity.length,
      sha256: 'a'.repeat(64),
      verified: true,
      verification: ['non-empty', 'zip-signature', 'xlsx-package'],
      contentBase64: entity.toString('base64'),
    });
    // The envelope is far past MAX_ARTIFACT_CHARS: truncating it
    // would corrupt the payload the envelope exists to carry, so a
    // clean envelope passes through untouched (detection runs on a
    // probe copy with the payload elided).
    expect(envelope.length).toBeGreaterThan(120_000);
    const result = await verifyAndSelfFixArtifact(envelope, 'document_generator');
    expect(result.ok).toBe(true);
    expect(result.selfFixed).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.artifact).toBe(envelope);
  });

  it('keeps the existing truncation for an ordinary oversize text artifact', async () => {
    const result = await verifyAndSelfFixArtifact('x'.repeat(150_000), 'document_generator');
    expect(result.ok).toBe(true);
    expect(result.artifact.length).toBe(120_000);
  });
});
