import { describe, it, expect } from 'vitest';
import {
  sanitizeSecrets,
  parseGeminiResponse,
  applyFileEdits,
} from '../scripts/run-autonomous-agent.mjs';

describe('run-autonomous-agent helpers', () => {
  it('sanitizeSecrets redacts provided secrets and common API key patterns', () => {
    const secretKey = 'my-super-secret-key-12345';
    const text = `Error with key ${secretKey} and Google key AIzaSyA1234567890123456789012345678901`;
    const clean = sanitizeSecrets(text, [secretKey]);

    expect(clean).not.toContain(secretKey);
    expect(clean).not.toContain('AIzaSyA1234567890123456789012345678901');
    expect(clean).toContain('[REDACTED]');
  });

  it('parseGeminiResponse extracts valid JSON file edits from raw markdown text', () => {
    const raw = `
Here are the edits:
\`\`\`json
[
  {
    "filepath": "src/hello.ts",
    "action": "write",
    "content": "console.log('hello');"
  }
]
\`\`\`
`;
    const edits = parseGeminiResponse(raw);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({
      filepath: 'src/hello.ts',
      action: 'write',
      content: "console.log('hello');",
    });
  });

  it('parseGeminiResponse returns empty array on invalid response', () => {
    expect(parseGeminiResponse('No JSON here')).toEqual([]);
    expect(parseGeminiResponse('')).toEqual([]);
    expect(parseGeminiResponse(null)).toEqual([]);
  });

  it('applyFileEdits throws on path traversal attempt', async () => {
    const maliciousEdits = [
      {
        filepath: '../../etc/passwd',
        action: 'write' as const,
        content: 'malicious',
      },
    ];

    await expect(applyFileEdits(maliciousEdits)).rejects.toThrow('Security Exception');
  });
});
