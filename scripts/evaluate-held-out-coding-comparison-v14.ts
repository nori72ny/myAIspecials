import { readFile } from 'node:fs/promises';
import {
  evaluateHeldOutCodingComparisonV14,
  type HeldOutCodingComparisonInputV14,
} from '../src/agent/heldOutCodingComparisonV14.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:heldout-coding:comparison -- <comparison-evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as HeldOutCodingComparisonInputV14;
const report = evaluateHeldOutCodingComparisonV14(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
