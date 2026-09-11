import { readFile } from 'node:fs/promises';
import { comparisonPrompt, compareAIResponses, scoreComparisonResponse } from '../src/agent/aiComparisonV14.js';
const [command, ...args] = process.argv.slice(2);
if (command === 'prompt') console.log(comparisonPrompt());
else if (command === 'compare' && args.length === 1) console.log(JSON.stringify(compareAIResponses(await readFile(args[0], 'utf8')), null, 2));
else if (command === 'score' && args.length === 3) {
  const [file, participant, provenance] = args;
  console.log(JSON.stringify(scoreComparisonResponse(await readFile(file, 'utf8'), participant, provenance), null, 2));
} else {
  console.error('Usage: node --import tsx scripts/compare-ai-answers-v14.ts prompt | score ANSWERS.json PARTICIPANT PROVENANCE | compare PARTICIPANTS.json');
  process.exitCode = 2;
}
