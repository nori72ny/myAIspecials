import { describe, expect, it } from 'vitest';

import {
  applyRasterIpPolicyV15,
  RASTER_IP_POLICY_BLOCK_MESSAGE_V15,
} from './rasterIpPolicyV15';

describe('rasterIpPolicyV15 (copyright policy, prompt side)', () => {
  it('passes a request with no protected name through byte-identical', () => {
    const input = '柴犬のイラストを描いて';
    const result = applyRasterIpPolicyV15(input);
    expect(result.action).toBe('pass');
    expect(result.prompt).toBe(input);
    expect(result.matches).toEqual([]);
    expect(result.blockReason).toBeNull();
  });

  it.each([
    '赤いワンピースを着た女性のイラスト',
    'アップルパイの写真',
    '青い鳥',
  ])('does not false-positive on everyday words that resemble entries: %s', (input) => {
    const result = applyRasterIpPolicyV15(input);
    expect(result.action).toBe('pass');
    expect(result.prompt).toBe(input);
  });

  it('rewrites a Japanese style qualifier, keeping the independently specified subject', () => {
    const result = applyRasterIpPolicyV15('ジブリ風の田園風景を描いて');
    expect(result.action).toBe('rewrite');
    expect(result.prompt).toBe('田園風景を描いて');
    expect(result.matches).toEqual([
      { id: 'ghibli', kind: 'studio', matched: 'ジブリ', role: 'style-qualifier' },
    ]);
  });

  it('rewrites an English "in the style of" qualifier', () => {
    const result = applyRasterIpPolicyV15('a countryside landscape in the style of Studio Ghibli');
    expect(result.action).toBe('rewrite');
    expect(result.prompt).toBe('a countryside landscape');
    expect(result.matches[0]).toMatchObject({ id: 'ghibli', role: 'style-qualifier' });
  });

  it('rewrites an English "-style" qualifier', () => {
    const result = applyRasterIpPolicyV15('a forest path, Ghibli-style');
    expect(result.action).toBe('rewrite');
    expect(result.prompt).not.toContain('Ghibli');
    expect(result.prompt).toContain('forest path');
  });

  it('rewrites a creator style qualifier (の画風)', () => {
    const result = applyRasterIpPolicyV15('宮崎駿の画風で描いた田園風景');
    expect(result.action).toBe('rewrite');
    expect(result.prompt).toBe('描いた田園風景');
    expect(result.matches[0]).toMatchObject({ id: 'hayao-miyazaki', kind: 'creator', role: 'style-qualifier' });
  });

  it('rewrites a brand possessive mention into the generic subject', () => {
    const result = applyRasterIpPolicyV15('スターバックスのカップを持つ女性の写真');
    expect(result.action).toBe('rewrite');
    expect(result.prompt).toBe('カップを持つ女性の写真');
    expect(result.matches[0]).toMatchObject({ id: 'starbucks', kind: 'brand', role: 'brand-mention' });
  });

  it('blocks a character asked for as the subject', () => {
    const result = applyRasterIpPolicyV15('ピカチュウのイラストを描いて');
    expect(result.action).toBe('block');
    expect(result.blockReason).toBe('protected-subject');
    expect(result.matches[0]).toMatchObject({ id: 'pikachu', role: 'subject' });
  });

  it('blocks a character depicted in a scene (the name is not a qualifier)', () => {
    const result = applyRasterIpPolicyV15('ミッキーマウスがチーズを食べている絵');
    expect(result.action).toBe('block');
    expect(result.blockReason).toBe('protected-subject');
  });

  it('blocks an English bare-subject character request', () => {
    const result = applyRasterIpPolicyV15('Draw Pikachu');
    expect(result.action).toBe('block');
    expect(result.blockReason).toBe('protected-subject');
  });

  it('blocks a brand logo request as a logo, not a mere mention', () => {
    const result = applyRasterIpPolicyV15('スターバックスのロゴを描いて');
    expect(result.action).toBe('block');
    expect(result.blockReason).toBe('protected-logo');
    expect(result.matches[0]).toMatchObject({ id: 'starbucks', role: 'logo' });
  });

  it('blocks an English brand logo request', () => {
    const result = applyRasterIpPolicyV15('the Starbucks logo on a cup');
    expect(result.action).toBe('block');
    expect(result.blockReason).toBe('protected-logo');
  });

  it('blocks when stripping the qualifier would leave no subject', () => {
    const result = applyRasterIpPolicyV15('ドラえもん風に描いて');
    expect(result.action).toBe('block');
    expect(result.blockReason).toBe('no-subject-after-rewrite');
  });

  it('blocks when any occurrence is a subject, even alongside a removable qualifier', () => {
    const result = applyRasterIpPolicyV15('ジブリ風のピカチュウを描いて');
    expect(result.action).toBe('block');
    expect(result.blockReason).toBe('protected-subject');
    expect(result.matches).toHaveLength(2);
  });

  it('exposes a plain-language block message with no internal terminology', () => {
    expect(RASTER_IP_POLICY_BLOCK_MESSAGE_V15).toContain('既存のキャラクターやブランドそのものを描くことはできません');
    expect(RASTER_IP_POLICY_BLOCK_MESSAGE_V15).not.toMatch(/IP|ポリシー|copyright/i);
  });
});
