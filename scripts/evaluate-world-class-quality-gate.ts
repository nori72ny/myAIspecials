import { readFile } from 'node:fs/promises';
import {
  evaluateOriginWorldClassQualityGate,
  type OriginWorldClassQualityInput,
} from '../src/release/OriginWorldClassQualityGate.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:world-class-quality -- <evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as OriginWorldClassQualityInput;
const report = evaluateOriginWorldClassQualityGate(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
