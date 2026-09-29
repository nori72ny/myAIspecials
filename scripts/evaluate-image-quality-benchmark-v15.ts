import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  evaluateOriginImageQualityBenchmarkV15,
  type OriginImageQualityBenchmarkInputV15,
} from '../src/creative/OriginImageQualityBenchmarkV15.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:image-quality -- <benchmark-evidence.json>');
  process.exit(2);
}

const bytes = await readFile(inputPath);
const input = JSON.parse(bytes.toString('utf8')) as OriginImageQualityBenchmarkInputV15;
const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
const report = evaluateOriginImageQualityBenchmarkV15(input, artifactSha256);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
