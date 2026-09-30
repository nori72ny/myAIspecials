import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { qualifyRasterLiveV15 } from '../src/creative/rasterLiveQualificationV15.js';

const outputPath = resolve(process.env.ORIGIN_RASTER_LIVE_EVIDENCE_PATH?.trim() || 'test-results/raster-live-qualification-v15.json');
const evidence = await qualifyRasterLiveV15();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

console.log(JSON.stringify({
  version: evidence.version,
  state: evidence.state,
  reason: evidence.reason,
  provider: evidence.provider.id,
  providerReady: evidence.provider.ready,
  generationSha256: evidence.generation?.sha256 ?? null,
  editSha256: evidence.edit?.sha256 ?? null,
  evidenceSha256: evidence.evidenceSha256,
  costUsd: evidence.invariants.costUsd,
  freeOnly: evidence.invariants.freeOnly,
  paidFallbackEnabled: evidence.invariants.paidFallbackEnabled,
  outputPath,
}, null, 2));

process.exitCode = evidence.state === 'passed' ? 0 : evidence.state === 'blocked' ? 2 : 1;
