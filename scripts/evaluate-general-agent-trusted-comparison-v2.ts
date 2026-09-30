import { readFile } from 'node:fs/promises';
import {
  evaluateGeneralAgentTrustedComparisonV2,
  type GeneralAgentTrustedComparisonInputV2,
} from '../src/agent/trustedGeneralAgentComparisonV2.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:heldout-agent:trusted-comparison -- <trusted-comparison-evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as GeneralAgentTrustedComparisonInputV2;
const report = evaluateGeneralAgentTrustedComparisonV2(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
