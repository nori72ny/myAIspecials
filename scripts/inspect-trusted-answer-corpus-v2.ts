import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseOriginAnswerExperienceSealedCorpusGzipBase64V2,
} from "../src/release/OriginAnswerExperienceSealedCorpusV2.js";

const encoded = process.env.ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64 ?? "";
if (!encoded) {
  process.stderr.write("AQ_V2_SEALED_CORPUS_MISSING\n");
  process.exit(2);
}

const prepared = parseOriginAnswerExperienceSealedCorpusGzipBase64V2(encoded);
const output = {
  schemaVersion: "origin.aq-v2-sealed-corpus-public-check.v1",
  corpusDigest: prepared.corpusDigest,
  caseCount: prepared.privateCorpus.cases.length,
};
if (output.caseCount !== 48) {
  process.stderr.write("AQ_V2_SEALED_CORPUS_CASE_COUNT_INVALID\n");
  process.exit(2);
}

const outputPath = process.env.ORIGIN_AQ_V2_CORPUS_CHECK_PATH
  ?? path.resolve("test-results", "aq-v2-corpus-public-check.json");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
process.stdout.write(JSON.stringify(output) + "\n");
