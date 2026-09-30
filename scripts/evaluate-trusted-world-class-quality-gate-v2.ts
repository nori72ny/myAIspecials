import { readFile } from 'node:fs/promises';
import {
  evaluateOriginTrustedWorldClassQualityGateV2,
  type OriginTrustedWorldClassQualityInputV2,
} from '../src/release/OriginTrustedWorldClassQualityGateV2.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:world-class-quality -- <trusted-raw-evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as OriginTrustedWorldClassQualityInputV2;
const report = evaluateOriginTrustedWorldClassQualityGateV2(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
