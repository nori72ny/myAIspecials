// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  extractAttachmentOutputFileSpecs,
  renderExecutionLog,
  renderRowsCsvWithColumns,
} from './agentMultiFileSpec.js';
import { computeBaselBia } from './agentBaselBia.js';

const BASEL_GOAL = [
  'Write final files under `output/`:',
  '',
  '- `classified_events.csv`',
  '- `capital_calculation.json`',
  '- `execution_log.txt`',
  '',
  '`classified_events.csv` must contain exactly one row for each input event.',
].join('\n');

describe('extractAttachmentOutputFileSpecs', () => {
  it('lists the Basel deliverables in goal order with their formats', () => {
    expect(extractAttachmentOutputFileSpecs(BASEL_GOAL)).toEqual([
      { filename: 'classified_events.csv', format: 'csv' },
      { filename: 'capital_calculation.json', format: 'json' },
      { filename: 'execution_log.txt', format: 'txt' },
    ]);
  });

  it('keeps a single output/<name> specification working', () => {
    expect(extractAttachmentOutputFileSpecs('Write the result to output/root_cause_analysis.json please.')).toEqual([
      { filename: 'root_cause_analysis.json', format: 'json' },
    ]);
  });

  it('scopes to the Required Outputs section and never lists schema inputs', () => {
    const goal = [
      'Classify the events in the attached files.',
      '',
      '## Visible Inputs',
      '- classified_events.schema.csv: the output schema of the classified events deliverable.',
      '- capital_calculation.schema.json: the output schema of the capital calculation deliverable.',
      '- execution_log.schema.txt: the format of the execution log deliverable.',
      '',
      '## Required Outputs',
      '1. classified_events.csv columns: Event_ID,Loss_Event_Category',
      '2. capital_calculation.json fields: alpha_coefficient',
      '3. execution_log.txt in the format of execution_log.schema.txt.',
    ].join('\n');
    expect(extractAttachmentOutputFileSpecs(goal)).toEqual([
      { filename: 'classified_events.csv', format: 'csv' },
      { filename: 'capital_calculation.json', format: 'json' },
      { filename: 'execution_log.txt', format: 'txt' },
    ]);
  });

  it('deduplicates and returns nothing when no deliverable is named', () => {
    expect(extractAttachmentOutputFileSpecs('Analyse the data. Also see classified_events.csv and classified_events.csv.')).toEqual([
      { filename: 'classified_events.csv', format: 'csv' },
    ]);
    expect(extractAttachmentOutputFileSpecs('Analyse the data.')).toEqual([]);
  });
});

describe('renderRowsCsvWithColumns', () => {
  it('renders in the fixed column order with CSV escaping', () => {
    const csv = renderRowsCsvWithColumns(
      [{ b: 'x,y', a: '1' }],
      ['a', 'b', 'c'],
    );
    expect(csv).toBe('a,b,c\n1,"x,y",');
  });
});

describe('renderExecutionLog', () => {
  it('describes the files, the rules and the BIA steps with real numbers', () => {
    const bia = computeBaselBia({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 2850000000, '2022': 3120000000, '2023': -456000000 },
    });
    const log = renderExecutionLog({
      files: [{ name: 'events.tsv', kind: 'table', rowCount: 60, charCount: 4918 }],
      outputs: ['classified_events.csv', 'capital_calculation.json', 'execution_log.txt'],
      requiredColumns: ['Event_ID', 'Loss_Event_Category'],
      coverage: { totalChunks: 8, processedChunks: 8, keyCount: 60 },
      bia,
    });
    expect(log).toContain('events.tsv');
    expect(log).toContain('298500000');
    expect(log).toContain('execution_log.txt');
  });
});
