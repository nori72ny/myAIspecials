// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assembleCapitalCalculationFromFiles,
  computeBaselBia,
  parseBaselBiaInputs,
} from './agentBaselBia.js';

const PARAMS_TSV = [
  '## sheet: Sheet1',
  'Parameter\tValue\tDescription',
  'Alpha_Coefficient\t0.15\tBasel mandated coefficient for BIA (15%)',
  'Gross_Income_Year_1_2021_CNY\t2850000000\t audited gross income for fiscal year 2021',
  'Gross_Income_Year_2_2022_CNY\t3120000000\t audited gross income for fiscal year 2022',
  'Gross_Income_Year_3_2023_CNY\t-456000000\t audited gross income for fiscal year 2023 (net loss)',
  'Calculation_Method\tBasic_Indicator_Approach\tBasel II Basic Indicator Approach',
].join('\n');

describe('parseBaselBiaInputs', () => {
  it('reads alpha and the yearly gross incomes from a parameter table', () => {
    const inputs = parseBaselBiaInputs([{ name: 'capital_calculation_params.tsv', text: PARAMS_TSV }]);
    expect(inputs).toEqual({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 2850000000, '2022': 3120000000, '2023': -456000000 },
    });
  });

  it('returns null when no file carries the parameter-table shape', () => {
    expect(parseBaselBiaInputs([{ name: 'events.tsv', text: 'id\tamount\nA\t1' }])).toBeNull();
    expect(parseBaselBiaInputs([])).toBeNull();
  });

  it('returns null when a promised value cannot be read', () => {
    const broken = PARAMS_TSV.replace('2850000000', 'not-a-number');
    expect(parseBaselBiaInputs([{ name: 'params.tsv', text: broken }])).toBeNull();
  });
});

describe('computeBaselBia', () => {
  it('computes the Basel production values exactly', () => {
    const result = computeBaselBia({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 2850000000, '2022': 3120000000, '2023': -456000000 },
    });
    expect(result.positiveGiSumCny).toBe(5970000000);
    expect(result.numberOfYears).toBe(3);
    expect(result.averageAnnualGiCny).toBe(1990000000);
    expect(result.orRegulatoryCapitalCny).toBe(298500000);
    expect(result.capitalRounded).toBe(false);
  });

  it('counts non-positive years in the denominator only', () => {
    const result = computeBaselBia({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 0, '2022': -100, '2023': 300 },
    });
    expect(result.positiveGiSumCny).toBe(300);
    expect(result.averageAnnualGiCny).toBe(100);
    expect(result.orRegulatoryCapitalCny).toBe(15);
  });

  it('reports an all-non-positive history as zero capital', () => {
    const result = computeBaselBia({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': -5, '2022': 0, '2023': -7 },
    });
    expect(result.positiveGiSumCny).toBe(0);
    expect(result.orRegulatoryCapitalCny).toBe(0);
  });

  it('flags rounding when the capital is not whole', () => {
    const result = computeBaselBia({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 100, '2022': 0, '2023': 0 },
    });
    // 100 * 0.15 / 3 = 5 exactly; use a value that does not divide.
    expect(result.orRegulatoryCapitalCny).toBe(5);
    const rounded = computeBaselBia({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 101, '2022': 0, '2023': 0 },
    });
    expect(rounded.capitalRounded).toBe(true);
    expect(rounded.orRegulatoryCapitalCny).toBe(5); // 5.05 -> 5
  });
});

describe('assembleCapitalCalculationFromFiles', () => {
  it('assembles the six schema fields in schema order', () => {
    const assembled = assembleCapitalCalculationFromFiles([
      { name: 'capital_calculation_params.tsv', text: PARAMS_TSV },
    ]);
    expect(assembled).not.toBeNull();
    const parsed = JSON.parse(assembled!.json) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'alpha_coefficient',
      'gross_income_years',
      'positive_gi_sum_cny',
      'number_of_years',
      'average_annual_gi_cny',
      'or_regulatory_capital_cny',
    ]);
    expect(parsed.or_regulatory_capital_cny).toBe(298500000);
  });
});
