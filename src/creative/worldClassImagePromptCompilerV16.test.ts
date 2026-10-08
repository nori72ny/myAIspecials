import { describe, expect, it } from 'vitest';
import { compileWorldClassImagePromptV16 } from './worldClassImagePromptCompilerV16';

describe('compileWorldClassImagePromptV16', () => {
  it('classifies text-heavy commercial work and preserves exact copy intent', () => {
    const plan = compileWorldClassImagePromptV16(
      '美容サロンの広告。見出し「初回限定 50%OFF」、価格「¥4,980」を大きく表示。',
      false,
    );
    expect(plan.profile).toBe('text-layout');
    expect(plan.prompt).toContain('初回限定 50%OFF');
    expect(plan.prompt).toContain('¥4,980');
    expect(plan.prompt).toContain('Do not translate, paraphrase, invent, omit, or duplicate text.');
  });

  it('retains fullwidth prices and brand typography exactly in advertising prompts', () => {
    const original = '美容広告：「初回限定５０％ＯＦＦ」 料金￥４，９８０ 全角文字ＡＢＣ';
    const plan = compileWorldClassImagePromptV16(original, false);
    expect(plan.profile).toBe('text-layout');
    expect(plan.prompt).toContain(original);
    expect(plan.prompt).toContain('￥４，９８０');
    expect(plan.prompt).not.toContain('初回限定50%OFF');
  });

  it('adds strict preservation constraints for image editing', () => {
    const plan = compileWorldClassImagePromptV16(
      '人物と商品はそのままに、背景だけ高級ホテルの夜景へ変更',
      true,
    );
    expect(plan.profile).toBe('product-commercial');
    expect(plan.prompt).toContain('preserve identity, product geometry');
    expect(plan.prompt).toContain('Apply only the requested change.');
  });

  it('prioritizes anatomy for portrait requests', () => {
    const plan = compileWorldClassImagePromptV16(
      '自然光の中で笑う女性のフォトリアルなポートレート',
      false,
    );
    expect(plan.profile).toBe('portrait');
    expect(plan.prompt).toContain('anatomically correct hands and fingers');
  });

  it('does not invent task content and keeps the user instruction first', () => {
    const raw = '青い陶器の花瓶を白背景で中央に配置';
    const plan = compileWorldClassImagePromptV16(raw, false);
    expect(plan.prompt.indexOf(raw)).toBeLessThan(plan.prompt.indexOf('EXECUTION CONSTRAINTS:'));
    expect(plan.prompt).toContain('Do not add unrequested subjects');
  });
});
