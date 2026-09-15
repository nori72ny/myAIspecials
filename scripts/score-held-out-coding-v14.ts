import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  scoreHeldOutCodingRunV14,
  summarizeHeldOutCodingRunsV14,
  type HeldOutCodingRunV14,
  type HeldOutCodingTaskV14,
} from '../src/agent/heldOutCodingBenchmarkV14.js';

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, 'utf8');
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('HELD_OUT_INPUT_LIMIT');
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const [taskPath, runPath] = process.argv.slice(2);
  if (!taskPath || !runPath) {
    throw new Error('usage: tsx scripts/score-held-out-coding-v14.ts <private-task-metadata.json> <run-evidence.json>');
  }
  const task = await readJson<HeldOutCodingTaskV14>(taskPath);
  const input = await readJson<HeldOutCodingRunV14 | HeldOutCodingRunV14[]>(runPath);
  const runs = Array.isArray(input) ? input : [input];
  if (runs.length < 1 || runs.length > 32) throw new Error('HELD_OUT_RUN_COUNT_INVALID');
  const scores = runs.map(run => scoreHeldOutCodingRunV14(task, run));
  const output = {
    scores,
    summary: summarizeHeldOutCodingRunsV14(scores),
    limitation: 'Deterministic evidence scoring only. Private prompt, hidden tests and expected patch are not loaded by this scorer.',
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'HELD_OUT_SCORER_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
