import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { planImageEditFreeShardsV1 } from '../src/release/OriginImageEditFreeShardPlanV1.js';

import {
  validateImageEditPrivateCorpusV1,
  type OriginImageEditPrivateCorpusV1,
} from '../src/release/OriginImageEditPrivateCorpusV1.js';

const encoded = process.env.ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_GZIP_B64?.trim() ?? '';
if (!encoded || encoded.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
  throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_ENCODING_INVALID');
}

let raw: Buffer;
let corpus: OriginImageEditPrivateCorpusV1;
try {
  raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 6_000_000 });
  corpus = JSON.parse(raw.toString('utf8')) as OriginImageEditPrivateCorpusV1;
} catch {
  throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_PARSE_FAILED');
}

const blockers = validateImageEditPrivateCorpusV1(corpus);
if (blockers.length) throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_VALIDATION_FAILED');

// In the Free-only evaluation workflow this runs BEFORE the account-day marker.
// A format header/hash is not proof of pixels. Reject any undecodable reference
// without spending model Neurons or consuming a candidate's once-per-day shard.
if (process.env.ORIGIN_IMAGE_EDIT_SOURCE_BROWSER_PREFLIGHT === 'true') {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      for (const task of corpus.tasks) {
        let decoded: { width: number; height: number };
        try {
          decoded = await page.evaluate(async (source: string) => {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('IMAGE_EDIT_CANVAS_UNAVAILABLE');
            context.drawImage(image, 0, 0, 1, 1);
            context.getImageData(0, 0, 1, 1);
            return { width: image.naturalWidth, height: image.naturalHeight };
          }, task.sourceImageDataUrl);
        } catch {
          throw new Error('IMAGE_EDIT_PRIVATE_SOURCE_PREFLIGHT_DECODE_FAILED');
        }
        if (decoded.width < 1 || decoded.height < 1 || decoded.width >= 512 || decoded.height >= 512) {
          throw new Error('IMAGE_EDIT_PRIVATE_SOURCE_PREFLIGHT_DIMENSIONS_INVALID');
        }
      }
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

const corpusDigest = createHash('sha256').update(raw).digest('hex');
const plan = planImageEditFreeShardsV1(corpus.candidateSha, corpusDigest, corpus.tasks.map(t => ({
  caseId: t.caseId, family: t.family, turnIndex: t.turnIndex,
  instructionSha256: t.instructionSha256, sourceImageSha256: t.sourceImageSha256,
  width: t.width, height: t.height,
})));

process.stdout.write(JSON.stringify({
  schemaVersion: 'origin.image-edit-private-corpus-metadata.v1',
  corpusId: corpus.corpusId,
  corpusDigest,
  candidateSha: corpus.candidateSha.toLowerCase(),
  executionBudgetMs: corpus.executionBudgetMs,
  taskCount: corpus.tasks.length,
  editShardPlanDigest: plan.planDigest,
  editShardCount: plan.shards.length,
  editShards: plan.shards.map(({ index, caseIds, instructionSha256s, sourceImageSha256s }) => ({
    index, caseIds, instructionSha256s, sourceImageSha256s,
  })),
}) + '\n');
