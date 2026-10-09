import { createHash } from 'node:crypto';
import { planImageWorkersFreeShardsV1 } from '../src/release/OriginImageWorkersFreeShardPlanV1.js';
import { gunzipSync } from 'node:zlib';

import {
  validateImagePrivateCorpusV1,
  type OriginImagePrivateCorpusV1,
} from '../src/release/OriginImagePrivateCorpusV1.js';

const encoded=process.env.ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64?.trim() ?? '';
if(!encoded || encoded.length>4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)){
  throw new Error('IMAGE_PRIVATE_CORPUS_ENCODING_INVALID');
}

let raw:Buffer;
let corpus:OriginImagePrivateCorpusV1;
try{
  raw=gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:4_000_000});
  corpus=JSON.parse(raw.toString('utf8')) as OriginImagePrivateCorpusV1;
}catch{
  throw new Error('IMAGE_PRIVATE_CORPUS_PARSE_FAILED');
}

const blockers=validateImagePrivateCorpusV1(corpus);
if(blockers.length) throw new Error('IMAGE_PRIVATE_CORPUS_VALIDATION_FAILED');

const corpusDigest = createHash('sha256').update(raw).digest('hex');
const shardPlan = planImageWorkersFreeShardsV1(corpus.candidateSha, corpusDigest, corpus.tasks);

process.stdout.write(JSON.stringify({
  schemaVersion:'origin.image-private-corpus-metadata.v1',
  corpusId:corpus.corpusId,
  corpusDigest,
  candidateSha:corpus.candidateSha.toLowerCase(),
  executionBudgetMs:corpus.executionBudgetMs,
  taskCount:corpus.tasks.length,
  shardPlanDigest: shardPlan.planDigest,
  shardCount: shardPlan.shards.length,
  shards: shardPlan.shards.map(({ index, caseIds, taskDigests, estimatedGenerationNeurons }) => ({
    index, caseIds, taskDigests, estimatedGenerationNeurons,
  })),
})+'\n');
