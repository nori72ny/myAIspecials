import fs from 'node:fs';

const path = 'src/lib/capability-registry/__tests__/CapabilityRegistry.test.ts';
let source = fs.readFileSync(path, 'utf8');
const replacements = new Map([
  ['openrouter/anthropic/claude-3.5-sonnet', 'anthropic/claude-3.5-sonnet'],
  ['openrouter/google/gemini-1.5-pro', 'google/gemini-1.5-pro'],
  ['openrouter/google/gemini-2.5-flash:free', 'google/gemini-2.5-flash:free']
]);

for (const [oldValue, newValue] of replacements) {
  source = source.replaceAll(oldValue, newValue);
}

fs.writeFileSync(path, source);
