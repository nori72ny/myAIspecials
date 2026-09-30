import { readFile } from 'node:fs/promises';
import {
  GENERAL_AGENT_COMPARISON_VERSION_V2,
  GENERAL_AGENT_HELD_OUT_VERSION_V2,
  evaluateGeneralAgentComparisonV2,
  scoreGeneralAgentHeldOutRunV2,
  type GeneralAgentHeldOutScoreV2,
  type GeneralAgentHeldOutTaskV2,
  type GeneralAgentReferenceSummaryV2,
} from '../src/agent/heldOutGeneralAgentBenchmarkV2.js';
import {
  buildTrustedGeneralAgentRunV2,
  type GeneralAgentTrustedEvidenceV2,
} from '../src/agent/trustedGeneralAgentEvidenceV2.js';

type Packet = {
  candidateSha: string;
  tasks: GeneralAgentHeldOutTaskV2[];
  evidence: GeneralAgentTrustedEvidenceV2[];
  references: GeneralAgentReferenceSummaryV2[];
};

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:heldout-agent:trusted -- <trusted-evidence.json>');
  process.exit(2);
}

const packet = JSON.parse(await readFile(inputPath, 'utf8')) as Packet;
const topLevelValid = Boolean(
  packet
  && typeof packet.candidateSha === 'string'
  && Array.isArray(packet.tasks)
  && Array.isArray(packet.evidence)
  && Array.isArray(packet.references)
  && packet.tasks.every(task => task && typeof task === 'object'
    && typeof task.id === 'string'
    && typeof task.taskDigest === 'string'
    && typeof task.candidateSha === 'string'
    && Array.isArray(task.capabilities))
  && packet.references.every(reference => reference && typeof reference === 'object'
    && typeof reference.participant === 'string'),
);

if (!topLevelValid) {
  console.error('GENERAL_AGENT_TRUSTED_EVIDENCE_INVALID');
  process.exit(2);
}

const evidenceByTask = new Map<string, GeneralAgentTrustedEvidenceV2>();
const buildErrors: Array<{ taskId: string; blockers: readonly string[] }> = [];

for (const item of packet.evidence) {
  if (!item || typeof item !== 'object' || typeof item.taskId !== 'string' || item.taskId.trim().length === 0) {
    buildErrors.push({ taskId: 'malformed-evidence', blockers: ['TRUSTED_EVIDENCE_ITEM_INVALID'] });
    continue;
  }
  if (evidenceByTask.has(item.taskId)) {
    buildErrors.push({ taskId: item.taskId, blockers: ['TRUSTED_EVIDENCE_DUPLICATE_TASK'] });
    continue;
  }
  evidenceByTask.set(item.taskId, item);
}

function missingScore(task: GeneralAgentHeldOutTaskV2, blocker: string): GeneralAgentHeldOutScoreV2 {
  return {
    version: GENERAL_AGENT_HELD_OUT_VERSION_V2,
    taskId: task.id,
    participant: 'missing-trusted-evidence',
    solved: false,
    identityPassed: false,
    planningPassed: false,
    executionPassed: false,
    verificationPassed: false,
    recoveryPassed: false,
    approvalPassed: false,
    stopCancelPassed: false,
    safetyPassed: false,
    regressionFree: false,
    blockers: [blocker],
  };
}

const candidateScores = packet.tasks.map(task => {
  const raw = evidenceByTask.get(task.id);
  if (!raw) {
    buildErrors.push({ taskId: task.id, blockers: ['TRUSTED_EVIDENCE_MISSING'] });
    return missingScore(task, 'TRUSTED_EVIDENCE_MISSING');
  }

  const built = buildTrustedGeneralAgentRunV2(task, raw);
  if ("blockers" in built) {
    buildErrors.push({ taskId: task.id, blockers: built.blockers });
    return missingScore(task, 'TRUSTED_EVIDENCE_BUILD_FAILED');
  }

  return scoreGeneralAgentHeldOutRunV2(task, built.run);
});

const report = evaluateGeneralAgentComparisonV2({
  version: GENERAL_AGENT_COMPARISON_VERSION_V2,
  candidateSha: packet.candidateSha,
  tasks: packet.tasks,
  candidateScores,
  references: packet.references,
});

console.log(JSON.stringify({ report, candidateScores, buildErrors }, null, 2));
if (!report.passed || buildErrors.length > 0) process.exit(1);
