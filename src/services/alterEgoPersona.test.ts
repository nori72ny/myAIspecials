import { describe, expect, it } from 'vitest';
import {
  ALTER_EGO_FIELD_KEYS,
  ALTER_EGO_FIELD_LABELS,
  buildAlterEgoInstruction,
} from './alterEgoPersona';

// Alter-ego persona instruction (owner instruction 2026-11-27 18:16 /
// 18:19 / 18:24 / 18:25; design ALTER_EGO_MODE_DESIGN_2026-11-27). The
// instruction is code — structure and rules only. These tests pin the
// owner's conversation rules and constraints, the capability guarantee
// (the persona limits manner, never what can be answered), the
// records-only grounding line for statements about the owner, and the
// hard rule that no personal data value ever appears in the text.

describe('alter-ego field structure', () => {
  it('fixes the eight fields in order', () => {
    expect(ALTER_EGO_FIELD_KEYS).toEqual([
      'nickname',
      'workLife',
      'likes',
      'values',
      'goal',
      'decisionStyle',
      'speechSamples',
      'memoryMemo',
    ]);
  });

  it('labels every field in both languages', () => {
    for (const language of ['ja', 'en'] as const) {
      for (const key of ALTER_EGO_FIELD_KEYS) {
        expect(ALTER_EGO_FIELD_LABELS[language][key].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildAlterEgoInstruction', () => {
  const instruction = buildAlterEgoInstruction();

  it('frames the mode as Orin himself with a switched personality, not a different character', () => {
    expect(instruction).toContain('you are Orin');
    expect(instruction).toContain('personality switches');
    expect(instruction).toContain('not a different character');
  });

  it('carries the owner conversation rules', () => {
    // Voice: first person 「僕」, casual with the owner.
    expect(instruction).toContain('「僕」');
    expect(instruction).toContain('タメ口');
    // Conclusion first, usually 2–4 sentences; his likely view first,
    // a differing view separated as 「僕の意見」.
    expect(instruction).toContain('lead with the conclusion');
    expect(instruction).toContain('2–4 sentences');
    expect(instruction).toContain('「僕の意見」');
    // Not agreeable to everything; exactly one question when short.
    expect(instruction).toContain('point out contradictions and oversights');
    expect(instruction).toContain('ask exactly one question');
    // No fabricated memories; speculation labelled; unverifiable said so.
    expect(instruction).toContain("Never fabricate the owner's experiences or memories");
    expect(instruction).toContain('Label speculation as speculation');
  });

  it('carries the owner constraints', () => {
    expect(instruction).toContain('Never ask for passwords, account numbers, PINs');
    expect(instruction).toContain('money, health or legal matters');
    expect(instruction).toContain('drop the persona act entirely');
    // 「覚えて」: restate in one line for the owner to see.
    expect(instruction).toContain('「覚えて」');
    expect(instruction).toContain('restate in a single line');
  });

  it('keeps the proxy discipline: companion for the owner only, never the owner himself', () => {
    expect(instruction).toContain('never use it to contact, message or answer third parties');
    expect(instruction).toContain('never claim to be the owner himself');
    expect(instruction).toContain('never finalize promises');
  });

  it('does not limit answering capability (owner instruction 2026-11-27 18:24)', () => {
    expect(instruction).toContain('Capability is unchanged');
    expect(instruction).toContain('General questions and specialist topics alike');
    expect(instruction).toContain('research/search routes');
    expect(instruction).toContain('Do not refuse or stop at "that is not in the records" for anything except statements about the owner himself');
  });

  it('draws the one grounding line: statements about the owner rest on the records only', () => {
    expect(instruction).toContain('Grounding boundary');
    expect(instruction).toContain('claims about the OWNER himself');
    expect(instruction).toContain('rest only on the records above');
    expect(instruction).toContain('general knowledge must never be dressed up as his view');
  });

  it('contains no personal data values — structure and rules only', () => {
    // The owner's actual data (his work, family, values, decision
    // style, accounts) lives only in the on-device store. None of it
    // may ever be baked into this instruction.
    for (const personalValue of ['福利厚生', '長野', '自分らしさ', 'まず試す', 'nori72ny', 'Pixel', 'gmail']) {
      expect(instruction).not.toContain(personalValue);
    }
  });
});
