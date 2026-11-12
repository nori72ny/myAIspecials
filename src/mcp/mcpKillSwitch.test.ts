// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isMcpEnabled } from './mcpKillSwitch.js';

describe('MCP kill switch (PR-1c)', () => {
  it("treats the exact string 'true' as the only enabled value", () => {
    expect(isMcpEnabled({ ORIGIN_MCP_ENABLED: 'true' })).toBe(true);
  });

  it.each([
    ['unset', undefined],
    ["'false'", 'false'],
    ["uppercase 'TRUE'", 'TRUE'],
    ["mixed case 'True'", 'True'],
    ["'1'", '1'],
    ["'yes'", 'yes'],
    ['empty string', ''],
    ['leading whitespace', ' true'],
    ['trailing whitespace', 'true '],
  ])('is disabled when the flag is %s', (_label, value) => {
    expect(isMcpEnabled(value === undefined ? {} : { ORIGIN_MCP_ENABLED: value })).toBe(false);
  });

  it('ignores unrelated variables', () => {
    expect(isMcpEnabled({ FREE_ONLY: 'true', ORIGIN_MCP_ENABLED: 'true' })).toBe(true);
    expect(isMcpEnabled({ FREE_ONLY: 'true' })).toBe(false);
  });
});
