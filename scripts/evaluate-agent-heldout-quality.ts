import { readFile } from 'node:fs/promises';
import {
  evaluateOriginAgentHeldoutBenchmark,
  type OriginAgentHeldoutBenchmarkInput,
} from '../src/release/OriginAgentHeldoutBenchmarkV1.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:agent-heldout-quality -- <evidence.json>');
  process.exit(2);
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as OriginAgentHeldoutBenchmarkInput;
const report = evaluateOriginAgentHeldoutBenchmark(input);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
