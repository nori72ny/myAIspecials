import fs from "node:fs";
import path from "node:path";
import {
  evaluateOriginClaudeCodeParityGate,
  type OriginProductQualityGateInput,
} from "../src/release/OriginProductQualityGateV1.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run eval:claude-code-parity -- <evidence.json>");
  process.exit(2);
}

const absolute = path.resolve(process.cwd(), inputPath);
let input: OriginProductQualityGateInput;
try {
  input = JSON.parse(fs.readFileSync(absolute, "utf8")) as OriginProductQualityGateInput;
} catch {
  console.error("CLAUDE_CODE_PARITY_EVIDENCE_INVALID");
  process.exit(2);
}

const report = evaluateOriginClaudeCodeParityGate({
  candidateSha: input.candidateSha,
  claudeCode: input.claudeCode,
});
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(report.parityEstablished ? 0 : 1);
