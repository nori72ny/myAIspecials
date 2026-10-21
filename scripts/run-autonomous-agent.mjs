import { execFileSync, execSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const MAX_RETRY_ATTEMPTS = 2;

/**
 * Sanitizes sensitive values (secrets) from any string.
 * @param {string} text
 * @param {string[]} secrets
 * @returns {string}
 */
export function sanitizeSecrets(text, secrets = []) {
  if (!text || typeof text !== 'string') return '';
  let clean = text;
  for (const secret of secrets) {
    if (secret && typeof secret === 'string' && secret.trim().length > 0) {
      clean = clean.replaceAll(secret, '[REDACTED]');
    }
  }
  // Generic pattern for potential Google/OpenAI API keys if matched
  clean = clean.replace(/AIzaSy[A-Za-z0-9_-]{30,40}/g, '[REDACTED]');
  clean = clean.replace(/sk-[A-Za-z0-9_-]{32,}/g, '[REDACTED]');
  return clean;
}

/**
 * Parses Gemini output into structured file edits array.
 * @param {string} rawText
 * @returns {Array<{filepath: string, content?: string, action?: 'write'|'delete'}>}
 */
export function parseGeminiResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const clean = rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const jsonStart = clean.indexOf('[');
  const jsonEnd = clean.lastIndexOf(']');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed)) {
        return parsed.filter(item => item && typeof item.filepath === 'string');
      }
    } catch {
      // Fallback
    }
  }
  return [];
}

/**
 * Applies file edits safely after enforcing path confinement within the project root.
 * @param {Array<{filepath: string, content?: string, action?: 'write'|'delete'}>} edits
 */
export async function applyFileEdits(edits) {
  const root = resolve(process.cwd());
  for (const edit of edits) {
    const fullPath = resolve(root, edit.filepath);
    const rel = relative(root, fullPath);

    // Enforce that path does not escape project root
    if (rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\')) {
      throw new Error(`Security Exception: Edit path outside working directory attempted (${edit.filepath})`);
    }

    if (edit.action === 'delete') {
      await unlink(fullPath).catch(() => undefined);
    } else {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, edit.content ?? '', 'utf8');
    }
  }
}

/**
 * Runs a command safely without shell expansion when args array is provided.
 * @param {string} command
 * @param {string[]} [args]
 * @returns {{ success: boolean, output: string }}
 */
export function runVerificationCommand(command, args) {
  try {
    const output = args
      ? execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 })
      : execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
    return { success: true, output };
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : '';
    const stderr = error.stderr ? String(error.stderr) : '';
    return { success: false, output: `${stdout}\n${stderr}`.trim() };
  }
}

/**
 * Main agent execution loop.
 */
export async function runAutonomousAgent(options = {}) {
  const taskInstruction = options.taskInstruction
    || process.argv[2]
    || process.env.TASK_INSTRUCTION;

  if (!taskInstruction || !taskInstruction.trim()) {
    console.error('Error: task_instruction is required (via CLI argument or TASK_INSTRUCTION env var).');
    process.exit(1);
  }

  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is required.');
    process.exit(1);
  }

  const secretsToRedact = [apiKey, process.env.GITHUB_TOKEN].filter(Boolean);

  console.log('Starting autonomous agent execution...');
  console.log(`Task instruction: ${sanitizeSecrets(taskInstruction, secretsToRedact)}`);

  const ai = new GoogleGenAI({ apiKey });
  let retryCount = 0;
  let previousErrors = '';
  let success = false;

  const systemInstruction = `You are an autonomous AI coding agent.
You are tasked with editing the codebase according to the user's instructions.
Respond strictly with a JSON array of file edits without additional markdown framing outside the JSON array.
Each element of the array must be an object with the following schema:
[
  {
    "filepath": "relative/path/to/file.ts",
    "action": "write" | "delete",
    "content": "Full new file content string"
  }
]
Do not include any secrets, API keys, or credentials in the output.`;

  while (retryCount <= MAX_RETRY_ATTEMPTS) {
    console.log(`\n--- Agent Attempt ${retryCount + 1} / ${MAX_RETRY_ATTEMPTS + 1} ---`);

    if (retryCount > 0) {
      console.log('Resetting workspace dirty state before applying new edit attempt...');
      runVerificationCommand('git', ['reset', '--hard']);
      runVerificationCommand('git', ['clean', '-fd']);
    }

    const prompt = retryCount === 0
      ? `Task Instruction:\n${taskInstruction}`
      : `Task Instruction:\n${taskInstruction}\n\nPrevious attempt failed verification with the following error output:\n${previousErrors}\n\nPlease generate corrected file edits to fix the errors and satisfy the instruction.`;

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.1,
        },
      });

      const responseText = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const edits = parseGeminiResponse(responseText);

      if (edits.length === 0) {
        console.warn('Warning: Gemini returned no file edits.');
      } else {
        console.log(`Applying ${edits.length} file edit(s)...`);
        await applyFileEdits(edits);
      }

      console.log('Running typecheck verification...');
      const typecheckResult = runVerificationCommand('npm', ['run', 'typecheck']);
      if (!typecheckResult.success) {
        console.error('Typecheck failed.');
        previousErrors = sanitizeSecrets(typecheckResult.output, secretsToRedact);
        retryCount += 1;
        continue;
      }
      console.log('Typecheck passed.');

      console.log('Running test verification...');
      const testResult = runVerificationCommand('npm', ['test']);
      if (!testResult.success) {
        console.error('Tests failed.');
        previousErrors = sanitizeSecrets(testResult.output, secretsToRedact);
        retryCount += 1;
        continue;
      }
      console.log('Tests passed.');

      success = true;
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Gemini API call or processing failed: ${sanitizeSecrets(errMsg, secretsToRedact)}`);
      previousErrors = sanitizeSecrets(errMsg, secretsToRedact);
      retryCount += 1;
    }
  }

  if (!success) {
    console.error(`\nAgent failed after ${MAX_RETRY_ATTEMPTS + 1} attempts.`);
    process.exit(1);
  }

  console.log('\nVerification succeeded. Preparing git branch and PR...');
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const branchName = `fix/agent-${timestamp}-${randomSuffix}`;

  try {
    execFileSync('git', ['config', 'user.name', 'github-actions[bot]'], { stdio: 'inherit' });
    execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], { stdio: 'inherit' });
    execFileSync('git', ['checkout', '-b', branchName], { stdio: 'inherit' });
    execFileSync('git', ['add', '-A'], { stdio: 'inherit' });

    const sanitizedSummary = sanitizeSecrets(taskInstruction.slice(0, 50).replace(/\n/g, ' '), secretsToRedact);
    const commitMsg = `fix(agent): ${sanitizedSummary}`;
    execFileSync('git', ['commit', '-m', commitMsg], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', branchName], { stdio: 'inherit' });

    const prTitle = `fix(agent): autonomous fix for "${sanitizedSummary}"`;
    const prBody = `Automated code fix generated by Autonomous Agent workflow.\n\nTask Instruction:\n> ${sanitizedSummary}\n\nVerification: Typecheck and Vitest passed successfully.`;

    execFileSync('gh', ['pr', 'create', '--title', prTitle, '--body', prBody, '--base', 'main'], { stdio: 'inherit' });

    console.log(`Successfully created PR for branch ${branchName}`);
  } catch (gitErr) {
    const msg = gitErr instanceof Error ? gitErr.message : String(gitErr);
    console.error(`Git / PR creation failed: ${sanitizeSecrets(msg, secretsToRedact)}`);
    process.exit(1);
  }
}

// If executed directly
if (process.argv[1] && process.argv[1].endsWith('run-autonomous-agent.mjs')) {
  runAutonomousAgent().catch((err) => {
    console.error('Fatal agent error:', err);
    process.exit(1);
  });
}
