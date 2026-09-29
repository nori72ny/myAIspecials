import { readFile } from 'node:fs/promises';
import {
  evaluateOriginImageBlindBenchmarkV15,
  type OriginImageBlindBenchmarkInputV15,
} from '../src/release/OriginImageBlindBenchmarkV15.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run eval:image-blind-quality -- <evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(path, 'utf8')) as OriginImageBlindBenchmarkInputV15;
const report = evaluateOriginImageBlindBenchmarkV15(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
