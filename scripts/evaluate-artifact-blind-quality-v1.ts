import { readFile } from 'node:fs/promises';
import {
  evaluateOriginArtifactBlindBenchmarkV1,
  type OriginArtifactBlindBenchmarkInputV1,
} from '../src/release/OriginArtifactBlindBenchmarkV1.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:artifact-blind-quality -- <evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as OriginArtifactBlindBenchmarkInputV1;
const report = evaluateOriginArtifactBlindBenchmarkV1(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
