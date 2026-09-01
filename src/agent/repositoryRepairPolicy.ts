export type RepairFailureKind = 'test' | 'typecheck' | 'build' | 'unknown';

export type RepairFailure = {
  kind: RepairFailureKind;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

export type RepairDecision =
  | { action: 'repair'; reason: string; fingerprint: string }
  | { action: 'stop'; reason: string; fingerprint: string };

const MAX_ATTEMPTS = 3;
const MAX_DIAGNOSTIC_CHARS = 12000;

function normalize(value: string): string {
  return value
    .slice(0, MAX_DIAGNOSTIC_CHARS)
    .replace(/\r/g, '')
    .replace(/\/[^\s]+\/node_modules\//g, '<node_modules>/')
    .replace(/\b\d+(?:\.\d+)*\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyRepairFailure(result: RepairFailure): RepairFailureKind {
  if (result.kind !== 'unknown') return result.kind;
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (text.includes('tsc') || text.includes('typescript')) return 'typecheck';
  if (text.includes('vitest') || text.includes('test failed') || text.includes('assert')) return 'test';
  if (text.includes('build') || text.includes('vite')) return 'build';
  return 'unknown';
}

export function fingerprintRepairFailure(result: RepairFailure): string {
  const kind = classifyRepairFailure(result);
  return `${kind}:${result.timedOut ? 'timeout' : 'exit'}:${normalize(`${result.stderr}\n${result.stdout}`)}`;
}

export function decideRepair(
  result: RepairFailure,
  attempt: number,
  previousFingerprints: readonly string[] = [],
): RepairDecision {
  const fingerprint = fingerprintRepairFailure(result);
  if (result.timedOut) return { action: 'stop', reason: 'Verification timed out; fail closed.', fingerprint };
  if (attempt >= MAX_ATTEMPTS) return { action: 'stop', reason: `Repair attempt limit reached (${MAX_ATTEMPTS}).`, fingerprint };
  if (previousFingerprints.includes(fingerprint)) {
    return { action: 'stop', reason: 'The same verification failure repeated; stopping to prevent a repair loop.', fingerprint };
  }
  return { action: 'repair', reason: `A bounded repair is permitted for ${classifyRepairFailure(result)} failure.`, fingerprint };
}

export const MAX_REPAIR_ATTEMPTS = MAX_ATTEMPTS;
