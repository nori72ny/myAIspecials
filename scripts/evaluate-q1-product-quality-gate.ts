import fs from "node:fs";
import path from "node:path";
import {
  evaluateOriginProductQualityGate,
  type OriginProductQualityGateInput,
} from "../src/release/OriginProductQualityGateV1.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run eval:q1-quality -- <evidence.json>");
  process.exit(2);
}

const absolute = path.resolve(process.cwd(), inputPath);
let input: OriginProductQualityGateInput;
try {
  input = JSON.parse(fs.readFileSync(absolute, "utf8")) as OriginProductQualityGateInput;
} catch {
  console.error("Q1_EVIDENCE_INVALID");
  process.exit(2);
}

const report = evaluateOriginProductQualityGate(input);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(report.passed ? 0 : 1);
