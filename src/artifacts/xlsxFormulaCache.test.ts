import { describe, expect, it } from 'vitest';
import { calculateFormulaCaches } from './xlsxFormulaCache.js';
import { generateArtifactV12 } from './artifactGeneratorV12.js';

describe('independent XLSX formula caches', () => {
  it('replaces a wrong input cache in the actual generated package', () => {
    const artifact = generateArtifactV12({ type: 'xlsx', rows: [['Amount'], [{ formula: '=200*200', cachedValue: 1 }]] });
    expect(artifact.bytes.toString()).toContain('<f>200*200</f><v>40000</v>');
    expect(artifact.bytes.toString()).not.toContain('<f>200*200</f><v>1</v>');
  });

  it('calculates booking costs at both sides of the break-even point', () => {
    const rows = [119, 120, 121, 200].map((people, i) => [people,
      { formula: `=200*A${i + 1}`, cachedValue: -999 },
      { formula: `=100*A${i + 1}+12000`, cachedValue: -999 },
      { formula: `=B${i + 1}-C${i + 1}` },
      { formula: `=D${i + 1}/B${i + 1}` },
    ]);
    const result = calculateFormulaCaches(rows);
    expect(result.map(row => row.slice(1, 4).map(value => (value as { cachedValue: number }).cachedValue)))
      .toEqual([[23800, 23900, -100], [24000, 24000, 0], [24200, 24100, 100], [40000, 32000, 8000]]);
    expect(result[3][4]).toEqual({ formula: '=D4/B4', cachedValue: 0.2 });
  });

  it('calculates SUM ranges, absolute/forward references, precedence and scientific constants', () => {
    const result = calculateFormulaCaches([
      [{ formula: '=SUM($B$1:B3)+2*(3+4)' }, 1200],
      [{ formula: '=$B$3/2' }, 1800],
      [{ formula: '=-2+1e3/4' }, 2200],
    ]);
    expect(result.map(row => row[0])).toEqual([
      { formula: '=SUM($B$1:B3)+2*(3+4)', cachedValue: 5214 },
      { formula: '=$B$3/2', cachedValue: 1100 },
      { formula: '=-2+1e3/4', cachedValue: 248 },
    ]);
  });

  it.each(['=1/0', '=AVERAGE(B1:B2)', '=A1', '=1+', '=2^3', '=TRUE', '=SUM(A1:XFD1048576)', '=B1 C1'])
    ('does not publish an unverified cache for %s', formula => {
      expect(calculateFormulaCaches([[{ formula, cachedValue: 999 }, 1, 2]])[0][0]).toEqual({ formula });
    });

  it('drops cyclic and dependent caches without hanging', () => {
    expect(calculateFormulaCaches([[{ formula: '=B1', cachedValue: 1 }, { formula: '=A1', cachedValue: 2 }]]))
      .toEqual([[{ formula: '=B1' }, { formula: '=A1' }]]);
  });

  it('ignores text and booleans only in SUM ranges and never mutates inputs', () => {
    const rows = [[{ formula: '=SUM(B1:D1)', cachedValue: -1 }, 'text', true, 12]];
    expect(calculateFormulaCaches(rows)[0][0]).toEqual({ formula: '=SUM(B1:D1)', cachedValue: 12 });
    expect(rows[0][0]).toEqual({ formula: '=SUM(B1:D1)', cachedValue: -1 });
  });
});
