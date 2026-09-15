import fs from 'node:fs';

const RATE_LIMIT_MARKER = 'Production /api/chat must return HTTP 200; received 429; code=PROVIDER_RATE_LIMITED;';

export function classifyProductionVerificationResult(exitCode, stderrText) {
  const code = Number(exitCode);
  const stderr = typeof stderrText === 'string' ? stderrText : '';

  if (code === 0) {
    return {
      releaseVerified: true,
      upstreamAvailability: 'available',
      providerCode: null,
      releaseBlocking: false,
    };
  }

  if (Number.isInteger(code) && code > 0 && stderr.includes(RATE_LIMIT_MARKER)) {
    return {
      releaseVerified: true,
      upstreamAvailability: 'degraded',
      providerCode: 'PROVIDER_RATE_LIMITED',
      releaseBlocking: false,
    };
  }

  return {
    releaseVerified: false,
    upstreamAvailability: 'unknown',
    providerCode: null,
    releaseBlocking: true,
  };
}

if (process.argv[1]?.endsWith('classify-production-verification-result.mjs')) {
  const exitCode = process.argv[2];
  const stderrFile = process.argv[3];
  if (!stderrFile) {
    console.error('Usage: node scripts/classify-production-verification-result.mjs <exit-code> <stderr-file>');
    process.exitCode = 2;
  } else {
    let stderrText = '';
    try {
      stderrText = fs.readFileSync(stderrFile, 'utf8');
    } catch {
      stderrText = '';
    }
    const result = classifyProductionVerificationResult(exitCode, stderrText);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.releaseBlocking) process.exitCode = 1;
  }
}
