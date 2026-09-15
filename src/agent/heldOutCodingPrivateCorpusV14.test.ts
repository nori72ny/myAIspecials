import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  HELD_OUT_PRIVATE_CORPUS_VERSION,
  parseHeldOutPrivateCorpusGzipB64V14,
  selectHeldOutPrivateTaskFromGzipB64V14,
  validateHeldOutPrivateCorpusV14,
  type HeldOutPrivateCorpusV14,
} from './heldOutCodingPrivateCorpusV14.js';
import {
  HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
  type HeldOutPrivateTaskPacketV14,
} from './heldOutCodingTrustedRunnerV14.js';

const BASE_SHA = 'a'.repeat(40);

function packet(id: string): HeldOutPrivateTaskPacketV14 {
  return {
    version: HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
    id,
    baseSha: BASE_SHA,
    timeBudgetMs: 120_000,
    requiredChangedPaths: ['src/example.ts', 'src/example.test.ts'],
    protectedPaths: ['tests/__origin_heldout__/private.test.ts'],
    recoveryRequired: true,
    goal: 'Repair the example implementation and preserve the existing public behavior.',
    hiddenTests: [{
      path: 'private.test.ts',
      content: "import { describe, expect, it } from 'vitest'; describe('private', () => { it('passes', () => expect(1).toBe(1)); });",
    }],
  };
}

function encode(corpus: HeldOutPrivateCorpusV14): string {
  return gzipSync(Buffer.from(JSON.stringify(corpus), 'utf8')).toString('base64');
}

describe('held-out private corpus v1', () => {
  it('parses a compressed corpus and selects only the requested opaque task id', () => {
    const corpus: HeldOutPrivateCorpusV14 = {
      version: HELD_OUT_PRIVATE_CORPUS_VERSION,
      tasks: [packet('heldout-a'), packet('heldout-b')],
    };
    const encoded = encode(corpus);
    expect(parseHeldOutPrivateCorpusGzipB64V14(encoded).tasks).toHaveLength(2);
    expect(selectHeldOutPrivateTaskFromGzipB64V14(encoded, 'heldout-b').id).toBe('heldout-b');
  });

  it('fails closed for duplicate task ids', () => {
    expect(() => validateHeldOutPrivateCorpusV14({
      version: HELD_OUT_PRIVATE_CORPUS_VERSION,
      tasks: [packet('heldout-a'), packet('heldout-a')],
    })).toThrow('HELD_OUT_PRIVATE_CORPUS_TASK_DUPLICATE');
  });

  it('fails closed when the dispatched task id does not exist', () => {
    const encoded = encode({ version: HELD_OUT_PRIVATE_CORPUS_VERSION, tasks: [packet('heldout-a')] });
    expect(() => selectHeldOutPrivateTaskFromGzipB64V14(encoded, 'heldout-missing')).toThrow('HELD_OUT_PRIVATE_TASK_NOT_FOUND');
  });

  it('rejects malformed base64 and non-gzip payloads', () => {
    expect(() => parseHeldOutPrivateCorpusGzipB64V14('not-base64!')).toThrow('HELD_OUT_PRIVATE_CORPUS_ENCODING_INVALID');
    expect(() => parseHeldOutPrivateCorpusGzipB64V14(Buffer.from('plain text').toString('base64'))).toThrow('HELD_OUT_PRIVATE_CORPUS_GZIP_INVALID');
  });

  it('inherits private packet validation for unsafe corpus entries', () => {
    const invalid = packet('heldout-a');
    invalid.requiredChangedPaths = ['../outside.ts', 'src/example.test.ts'];
    expect(() => validateHeldOutPrivateCorpusV14({
      version: HELD_OUT_PRIVATE_CORPUS_VERSION,
      tasks: [invalid],
    })).toThrow('HELD_OUT_PRIVATE_MULTIFILE_REQUIRED');
  });
});
