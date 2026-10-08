import { describe, expect, it } from 'vitest';
import { agentCodingBridgeEnabledV3 } from './agentCodingBridgeConfigV3.js';

describe('agentCodingBridgeEnabledV3', () => {
  it('is fail-closed unless explicitly set to literal true', () => {
    expect(agentCodingBridgeEnabledV3({})).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'false' })).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'TRUE' })).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ORIGIN_AGENT_CODING_BRIDGE_ENABLED: '1' })).toBe(false);
    expect(agentCodingBridgeEnabledV3({ ORIGIN_AGENT_CODING_BRIDGE_ENABLED: 'true' })).toBe(true);
  });
});
