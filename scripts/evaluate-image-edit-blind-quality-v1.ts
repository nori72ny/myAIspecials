import { readFile } from 'node:fs/promises';
import {
  evaluateOriginImageEditBlindBenchmarkV1,
  type OriginImageEditBlindInputV1,
} from '../src/release/OriginImageEditBlindBenchmarkV1.js';

// The standalone 16-case blind judge evaluator has no model access and never
// infers success from technical checks alone. External independently blinded
// judge data must already be collected and authenticated.
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npm run eval:image-edit-blind-quality -- <evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(filePath, 'utf8')) as OriginImageEditBlindInputV1;
const report = evaluateOriginImageEditBlindBenchmarkV1(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
