import { readFile } from 'node:fs/promises';
import {
  evaluateHeldOutCodingTrustedComparisonV14,
  type HeldOutCodingTrustedComparisonInputV14,
} from '../src/agent/heldOutCodingTrustedComparisonV14.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:heldout-coding:trusted-comparison -- <trusted-comparison-evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as HeldOutCodingTrustedComparisonInputV14;
const report = evaluateHeldOutCodingTrustedComparisonV14(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
