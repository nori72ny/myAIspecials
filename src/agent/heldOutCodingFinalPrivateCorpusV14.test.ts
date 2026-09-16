// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14,
  parseHeldOutFinalPrivateCorpusGzipBase64V14,
  prepareHeldOutFinalPrivateCorpusV14,
  publicHeldOutFinalCorpusFromPrivateV14,
  type HeldOutFinalPrivateCorpusV14,
} from './heldOutCodingFinalPrivateCorpusV14.js';
import { HELD_OUT_FINAL_QUALIFICATION_VERSION_V14 } from './heldOutCodingFinalQualificationV14.js';
import { HELD_OUT_PRIVATE_TASK_PACKET_VERSION, type HeldOutPrivateTaskPacketV14 } from './heldOutCodingTrustedRunnerV14.js';

const baseSha = 'a'.repeat(40);

function packet(index: number, recoveryRequired = false): HeldOutPrivateTaskPacketV14 {
  return {
    version: HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
    id: `sealed-final-${index}`,
    baseSha,
    timeBudgetMs: 900_000,
    requiredChangedPaths: [`src/agent/sealed-final-${index}.ts`, `src/agent/sealed-final-${index}-helper.ts`],
    protectedPaths: [`tests/__origin_heldout__/sealed-final-${index}.test.ts`],
    recoveryRequired,
    goal: `Implement synthetic sealed final task ${index} without changing protected tests.`,
    hiddenTests: [{
      path: `tests/__origin_heldout__/sealed-final-${index}.test.ts`,
      content: `import { describe, it, expect } from 'vitest'; describe('sealed ${index}', () => { it('passes', () => expect(true).toBe(true)); });`,
    }],
  };
}

function corpus(): HeldOutFinalPrivateCorpusV14 {
  return {
    version: HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14,
    qualification: HELD_OUT_FINAL_QUALIFICATION_VERSION_V14,
    corpusId: 'sealed-final-synthetic',
    tasks: [
      { coverage: ['navigationMultiFile'], packet: packet(1, true) },
      { coverage: ['featureWithNewFile'], packet: packet(2, true) },
      { coverage: ['regressionRecovery'], packet: packet(3) },
      { coverage: ['buildOrTypecheckRepair'], packet: packet(4) },
      { coverage: ['securityPathBoundary'], packet: packet(5) },
      { coverage: ['navigationMultiFile', 'regressionRecovery'], packet: packet(6) },
    ],
  };
}

describe('V1.4 sealed final private corpus', () => {
  it('derives only public identity/coverage fields and qualifies six fresh tasks', () => {
    const value = corpus();
    const prepared = prepareHeldOutFinalPrivateCorpusV14(value);
    expect(prepared.publicCorpus.tasks).toHaveLength(6);
    expect(prepared.publicCorpus.coverage).toEqual({
      navigationMultiFile: true,
      featureWithNewFile: true,
      regressionRecovery: true,
      buildOrTypecheckRepair: true,
      securityPathBoundary: true,
    });
    expect(prepared.publicCorpus.corpusDigest).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(prepared.publicCorpus);
    expect(serialized).not.toContain('Implement synthetic sealed final task');
    expect(serialized).not.toContain('hiddenTests');
  });

  it('parses a bounded gzip/base64 corpus and preserves the public projection', () => {
    const value = corpus();
    const encoded = gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
    const parsed = parseHeldOutFinalPrivateCorpusGzipBase64V14(encoded);
    expect(parsed.publicCorpus).toEqual(publicHeldOutFinalCorpusFromPrivateV14(value));
  });

  it('rejects fewer than six tasks, missing coverage, duplicate task ids and non-uniform bases', () => {
    const tooFew = corpus();
    tooFew.tasks = tooFew.tasks.slice(0, 5);
    expect(() => prepareHeldOutFinalPrivateCorpusV14(tooFew)).toThrow('HELD_OUT_FINAL_PRIVATE_TASK_COUNT_INVALID');

    const missingCoverage = corpus();
    missingCoverage.tasks = missingCoverage.tasks.map(row => ({ ...row, coverage: row.coverage.filter(key => key !== 'securityPathBoundary') }));
    expect(() => prepareHeldOutFinalPrivateCorpusV14(missingCoverage)).toThrow('HELD_OUT_FINAL_NOT_ELIGIBLE');

    const duplicate = corpus();
    duplicate.tasks[1] = { ...duplicate.tasks[1], packet: { ...duplicate.tasks[1].packet, id: duplicate.tasks[0].packet.id } };
    expect(() => prepareHeldOutFinalPrivateCorpusV14(duplicate)).toThrow('HELD_OUT_FINAL_PRIVATE_TASK_ID_DUPLICATE');

    const mixedBase = corpus();
    mixedBase.tasks[2] = { ...mixedBase.tasks[2], packet: { ...mixedBase.tasks[2].packet, baseSha: 'b'.repeat(40) } };
    expect(() => prepareHeldOutFinalPrivateCorpusV14(mixedBase)).toThrow(/base-sha-not-uniform/);
  });

  it('rejects malformed base64/gzip/json before private task execution', () => {
    expect(() => parseHeldOutFinalPrivateCorpusGzipBase64V14('not base64!')).toThrow('HELD_OUT_FINAL_PRIVATE_CORPUS_ENCODING_INVALID');
    expect(() => parseHeldOutFinalPrivateCorpusGzipBase64V14(Buffer.from('not gzip').toString('base64'))).toThrow('HELD_OUT_FINAL_PRIVATE_CORPUS_GZIP_INVALID');
    const invalidJson = gzipSync(Buffer.from('{')).toString('base64');
    expect(() => parseHeldOutFinalPrivateCorpusGzipBase64V14(invalidJson)).toThrow('HELD_OUT_FINAL_PRIVATE_CORPUS_JSON_INVALID');
  });
});
