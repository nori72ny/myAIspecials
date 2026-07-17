import * as fs from 'node:fs';
import * as path from 'node:path';
import { evaluateAnswerQuality } from '../src/lib/evaluation/AnswerQualityEvaluation';
import { ANSWER_QUALITY_FIXTURES_V1, getAnswerQualityFixture } from '../src/lib/evaluation/AnswerQualityFixtures';

interface CliOptions {
  fixtureId?: string;
  answerFile?: string;
  listFixtures: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { listFixtures: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--list') {
      options.listFixtures = true;
      continue;
    }
    if (arg === '--fixture') {
      options.fixtureId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--answer-file') {
      options.answerFile = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/run-answer-quality-evaluation.ts --list
  npx tsx scripts/run-answer-quality-evaluation.ts --fixture <fixture-id> --answer-file <path>

The command runs locally. It does not call external APIs and does not persist the answer.`);
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.listFixtures) {
      console.log(
        JSON.stringify(
          ANSWER_QUALITY_FIXTURES_V1.map(({ id, title, axes, minimumScore }) => ({
            id,
            title,
            axes,
            minimumScore,
          })),
          null,
          2,
        ),
      );
      return;
    }

    if (!options.fixtureId || !options.answerFile) {
      printUsage();
      process.exitCode = 2;
      return;
    }

    const answerPath = path.resolve(process.cwd(), options.answerFile);
    if (!fs.existsSync(answerPath) || !fs.statSync(answerPath).isFile()) {
      throw new Error(`Answer file not found: ${answerPath}`);
    }

    const answer = fs.readFileSync(answerPath, 'utf8');
    const fixture = getAnswerQualityFixture(options.fixtureId);
    const result = evaluateAnswerQuality(fixture, answer);

    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 2;
  }
}

main();
