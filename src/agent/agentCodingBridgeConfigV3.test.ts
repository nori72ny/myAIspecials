import { describe, expect, it } from 'vitest';
import { agentCodingBridgeEnabledV3 } from './agentCodingBridgeConfigV3.js';

const separated = {
  ORIGIN_AGENT_APPROVAL_SECRET: 'a'.repeat(48),
  ORIGIN_AGENT_OPERATOR_SECRET: 'b'.repeat(48),
};

describe('agentCodingBridgeEnabledV3', () => {
  it('is fail-closed unless explicitly set to literal true with distinct valid operator credentials', () => {
    expect(agentCodingBridgeEnabledV3({})).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ...separated, ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'false' })).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ...separated, ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'TRUE' })).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ...separated, ORIGIN_AGENT_CODING_BRIDGE_ENABLED: '1' })).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ...separated, ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'true' })).toBe(true);
  });

  it('never activates with legacy shared signing-key authentication, even when flag is true', () => {
    expect(agentCodingBridgeEnabledV3({
      ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'true',
      ORIGIN_AGENT_APPROVAL_SECRET: 'a'.repeat(48),
    })).toBe(false);
    expect(agentCodingBridgeEnabledV3({
      ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'true',
      ORIGIN_AGENT_APPROVAL_SECRET: 'a'.repeat(48),
      ORIGIN_AGENT_OPERATOR_SECRET: 'a'.repeat(48),
    })).toBe(false);
    expect(agentCodingBridgeEnabledV3({
      ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'true',
      ORIGIN_AGENT_APPROVAL_SECRET: 'a'.repeat(48),
      ORIGIN_AGENT_OPERATOR_SECRET: 'short',
    })).toBe(false);
  });
});
