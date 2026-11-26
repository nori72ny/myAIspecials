import { describe, expect, it } from 'vitest';
import type { AgentDataRow } from './agentAttachmentData.js';
import {
  applyBusinessLineDepartmentCheck,
  parseBusinessLineDepartmentMap,
  parseEventDepartments,
} from './agentBaselBusinessLines.js';

/**
 * B-2 fixtures mirror the production Basel set's tables (same
 * headers, the departments the rerun diagnosis named): BL8's
 * Key_Departments carry 证券营业部/经纪业务部， BL6 carries the
 * similar-named 证券服务部， BL3 carries 零售银行部.
 */
const MAPPING = [
  '## sheet: Sheet1',
  ['BL_Code', 'BL_Name_EN', 'BL_Name_CN', 'Description', 'Key_Departments', 'Key_Keywords'].join('\t'),
  ['BL3', 'Retail Banking', '零售银行', 'Retail deposits and loans', '零售银行部, 个人银行部', 'retail'].join('\t'),
  ['BL6', 'Agency Services', '代理服务', 'Custody and agency', '证券服务部, 托管部', 'agency'].join('\t'),
  ['BL8', 'Retail Brokerage', '零售经纪', 'Retail brokerage', '经纪业务部, 证券营业部, 网上交易部', 'brokerage'].join('\t'),
].join('\n');

const EVENTS = [
  ['Event_ID', 'Event_Description_CN', 'Loss_Amount_CNY', 'Event_Date', 'Involved_Department'].join('\t'),
  ['OR001', '营业部员工违规销售', '100', '2023-01-01', '证券营业部'].join('\t'),
  ['OR002', '零售贷款欺诈', '200', '2023-01-02', '零售银行部'].join('\t'),
  ['OR003', '系统故障', '300', '2023-01-03', '信息技术部'].join('\t'),
].join('\n');

const FILES = [
  { name: 'operational_risk_events.tsv.txt', text: EVENTS },
  { name: 'business_line_mapping.tsv.txt', text: MAPPING },
];

const row = (Event_ID: string, Business_Line: string): AgentDataRow => ({
  Event_ID, Loss_Event_Category: 'EL7', Business_Line, Loss_Amount_CNY: '100',
});

describe('parseBusinessLineDepartmentMap / parseEventDepartments (B-2)', () => {
  it('reads the set’s own mapping, including the similar-name trap', () => {
    const map = parseBusinessLineDepartmentMap(FILES);
    expect(map?.get('证券营业部')).toBe('BL8');
    expect(map?.get('经纪业务部')).toBe('BL8');
    expect(map?.get('证券服务部')).toBe('BL6');
    expect(map?.get('零售银行部')).toBe('BL3');
    const departments = parseEventDepartments(FILES);
    expect(departments?.get('OR001')).toBe('证券营业部');
    expect(departments?.get('OR003')).toBe('信息技术部');
  });

  it('returns null when the set carries no mapping table', () => {
    expect(parseBusinessLineDepartmentMap([{ name: 'events.tsv', text: EVENTS }])).toBeNull();
    expect(parseEventDepartments([{ name: 'mapping.tsv', text: MAPPING }])).toBeNull();
  });

  it('drops a department the table names for two different lines', () => {
    const ambiguous = [
      { name: 'mapping.tsv', text: [
        ['BL_Code', 'Key_Departments'].join('\t'),
        ['BL1', '共同部, 単独部署'].join('\t'),
        ['BL2', '共同部'].join('\t'),
      ].join('\n') },
    ];
    const map = parseBusinessLineDepartmentMap(ambiguous);
    expect(map?.has('共同部')).toBe(false);
    expect(map?.get('単独部署')).toBe('BL1');
  });
});

describe('applyBusinessLineDepartmentCheck (B-2)', () => {
  it('corrects rows whose department the mapping names, and records the corrections', () => {
    const rows = [row('OR001', 'BL6'), row('OR002', 'BL4')];
    const result = applyBusinessLineDepartmentCheck({
      files: FILES, rows, keyField: 'Event_ID',
      requiredOutputColumns: ['Event_ID', 'Loss_Event_Category', 'Business_Line', 'Loss_Amount_CNY'],
    });
    expect(rows.map((entry) => entry.Business_Line)).toEqual(['BL8', 'BL3']);
    expect(result?.corrections).toEqual([
      { key: 'OR001', department: '证券营业部', from: 'BL6', to: 'BL8' },
      { key: 'OR002', department: '零售银行部', from: 'BL4', to: 'BL3' },
    ]);
    expect(result?.unmappedDepartments).toEqual([]);
  });

  it('leaves an unmapped department’s row untouched and reports it — never assigns without basis', () => {
    const rows = [row('OR003', 'BL5')];
    const result = applyBusinessLineDepartmentCheck({
      files: FILES, rows, keyField: 'Event_ID',
      requiredOutputColumns: ['Event_ID', 'Loss_Event_Category', 'Business_Line', 'Loss_Amount_CNY'],
    });
    expect(rows[0]?.Business_Line).toBe('BL5');
    expect(result?.corrections).toEqual([]);
    expect(result?.unmappedDepartments).toEqual(['信息技术部']);
  });

  it('is a no-op (null) for a set without the mapping tables', () => {
    const rows = [row('OR001', 'BL6')];
    const result = applyBusinessLineDepartmentCheck({
      files: [{ name: 'events.tsv', text: EVENTS }], rows, keyField: 'Event_ID',
    });
    expect(result).toBeNull();
    expect(rows[0]?.Business_Line).toBe('BL6');
  });
});
