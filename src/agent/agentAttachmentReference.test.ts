// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildAgentReferenceContext } from './agentAttachmentReference.js';

const EVENTS_TSV = ['Event_ID\tEvent_Description_CN', 'OR001\t説明'].join('\n');
const CATEGORIES_TSV = [
  'Category_Code\tCategory_Name_EN\tDefinition\tKey_Indicators',
  'EL1\tInternal Fraud\tA very long definition that must be projected out.\tunauthorized trading, embezzlement',
  'EL2\tExternal Fraud\tAnother long definition.\thacking, phishing',
].join('\n');
const MAPPING_TSV = [
  'Department\tBusiness_Line_Code\tBusiness_Line_Name_EN',
  'Retail Banking Operations\tBL2\tRetail Banking',
].join('\n');
const PARAMS_TSV = [
  'Parameter\tValue\tDescription',
  'Alpha_Coefficient\t0.15\tBasel mandated coefficient',
  'Gross_Income_Year_1_2021_CNY\t2850000000\taudited gross income',
].join('\n');
const SCHEMA_CSV = ['Event_ID,Loss_Event_Category', 'EXAMPLE001,EL1'].join('\n');

describe('buildAgentReferenceContext', () => {
  it('co-locates the definition tables, projected, without schema samples or parameter tables', () => {
    const context = buildAgentReferenceContext(
      [
        { name: 'events.tsv', text: EVENTS_TSV },
        { name: 'loss_event_categories.tsv', text: CATEGORIES_TSV },
        { name: 'business_line_mapping.tsv', text: MAPPING_TSV },
        { name: 'capital_calculation_params.tsv', text: PARAMS_TSV },
        { name: 'classified_events.schema.csv', text: SCHEMA_CSV },
      ],
      'events.tsv',
    );
    expect(context).toContain('EL1');
    expect(context).toContain('unauthorized trading');
    expect(context).toContain('BL2');
    expect(context).not.toContain('very long definition');
    expect(context).not.toContain('EXAMPLE001');
    expect(context).not.toContain('Alpha_Coefficient');
  });

  it('is empty for a single-table set and without a primary table', () => {
    expect(buildAgentReferenceContext([{ name: 'events.tsv', text: EVENTS_TSV }], 'events.tsv')).toBe('');
    expect(buildAgentReferenceContext([{ name: 'events.tsv', text: EVENTS_TSV }], undefined)).toBe('');
  });

  it('never cuts a definition mid-row when the cap binds', () => {
    const bigRows = Array.from({ length: 400 }, (_, i) => `EL${i}\tName ${i}\tdefinition padding ${'x'.repeat(40)}\tkw${i}`).join('\n');
    const big = ['Category_Code\tCategory_Name_EN\tDefinition\tKey_Indicators', bigRows].join('\n');
    const context = buildAgentReferenceContext(
      [
        { name: 'events.tsv', text: EVENTS_TSV },
        { name: 'categories.tsv', text: big },
      ],
      'events.tsv',
    );
    expect(context.length).toBeLessThanOrEqual(8_000);
    const lines = context.split('\n');
    expect(lines[lines.length - 1]).toMatch(/^EL\d+\tName \d+\tkw\d+$/);
  });
});
