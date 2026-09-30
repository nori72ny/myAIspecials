import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2,
  digestGeneralAgentTrustedReferenceArtifactV2,
  digestGeneralAgentTrustedRoundArtifactV2,
  evaluateGeneralAgentTrustedComparisonV2,
  type GeneralAgentTrustedComparisonInputV2,
  type GeneralAgentTrustedReferenceEvidenceV2,
} from '../src/agent/trustedGeneralAgentComparisonV2.js';
import type { GeneralAgentHeldOutTaskV2 } from '../src/agent/heldOutGeneralAgentBenchmarkV2.js';
import type { GeneralAgentTrustedEvidenceV2 } from '../src/agent/trustedGeneralAgentEvidenceV2.js';

const MAX_REFERENCE_PACK_B64 = 8_000_000;
const MAX_REFERENCE_PACK_BYTES = 8_000_000;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;

type CandidatePublicPacket = {
  schemaVersion: 'origin.general-agent-private-public-tasks.v1';
  corpusId: string;
  corpusDigest: string;
  candidateSha: string;
  permissionProfileDigest: string;
  tasks: readonly GeneralAgentHeldOutTaskV2[];
};

type ReferencePackEntry = {
  source: 'controlled-external';
  independentFromCandidate: true;
  participant: string;
  evidenceId: string;
  createdAt: string;
  expiresAt: string;
  runs: readonly GeneralAgentTrustedEvidenceV2[];
};

type ReferencePack = {
  schemaVersion: 'origin.general-agent-reference-pack.v1';
  candidateSha: string;
  corpusId: string;
  corpusDigest: string;
  permissionProfileDigest: string;
  references: readonly ReferencePackEntry[];
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GENERAL_AGENT_COMPARISON_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function parseReferencePack(encoded: string): ReferencePack {
  if (encoded.length > MAX_REFERENCE_PACK_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('GENERAL_AGENT_REFERENCE_PACK_ENCODING_INVALID');
  }
  try {
    const raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_REFERENCE_PACK_BYTES });
    return JSON.parse(raw.toString('utf8')) as ReferencePack;
  } catch {
    throw new Error('GENERAL_AGENT_REFERENCE_PACK_PARSE_FAILED');
  }
}

function assertCandidatePacket(
  packet: CandidatePublicPacket,
  candidateSha: string,
  corpusId: string,
): void {
  if (packet?.schemaVersion !== 'origin.general-agent-private-public-tasks.v1') {
    throw new Error('GENERAL_AGENT_CANDIDATE_PACKET_SCHEMA_INVALID');
  }
  if (packet.candidateSha?.toLowerCase() !== candidateSha) {
    throw new Error('GENERAL_AGENT_CANDIDATE_PACKET_SHA_MISMATCH');
  }
  if (packet.corpusId !== corpusId) throw new Error('GENERAL_AGENT_CANDIDATE_PACKET_CORPUS_ID_MISMATCH');
  if (!SHA256.test(packet.corpusDigest ?? '')) throw new Error('GENERAL_AGENT_CANDIDATE_PACKET_CORPUS_DIGEST_INVALID');
  if (!SHA256.test(packet.permissionProfileDigest ?? '')) {
    throw new Error('GENERAL_AGENT_CANDIDATE_PACKET_PERMISSION_DIGEST_INVALID');
  }
  if (!Array.isArray(packet.tasks) || packet.tasks.length < 12 || packet.tasks.length > 24) {
    throw new Error('GENERAL_AGENT_CANDIDATE_PACKET_TASKS_INVALID');
  }
}

function assertReferencePack(
  pack: ReferencePack,
  candidate: CandidatePublicPacket,
): void {
  if (pack?.schemaVersion !== 'origin.general-agent-reference-pack.v1') {
    throw new Error('GENERAL_AGENT_REFERENCE_PACK_SCHEMA_INVALID');
  }
  if (pack.candidateSha?.toLowerCase() !== candidate.candidateSha.toLowerCase()) {
    throw new Error('GENERAL_AGENT_REFERENCE_PACK_SHA_MISMATCH');
  }
  if (pack.corpusId !== candidate.corpusId) throw new Error('GENERAL_AGENT_REFERENCE_PACK_CORPUS_ID_MISMATCH');
  if (pack.corpusDigest !== candidate.corpusDigest) throw new Error('GENERAL_AGENT_REFERENCE_PACK_CORPUS_DIGEST_MISMATCH');
  if (pack.permissionProfileDigest !== candidate.permissionProfileDigest) {
    throw new Error('GENERAL_AGENT_REFERENCE_PACK_PERMISSION_DIGEST_MISMATCH');
  }
  if (!Array.isArray(pack.references) || pack.references.length < 2) {
    throw new Error('GENERAL_AGENT_REFERENCE_PACK_REFERENCES_LT_2');
  }
  const names = pack.references.map(reference => reference?.participant?.trim().toLowerCase() ?? '');
  if (names.some(name => !name) || new Set(names).size !== names.length) {
    throw new Error('GENERAL_AGENT_REFERENCE_PACK_PARTICIPANTS_INVALID');
  }
  for (const reference of pack.references) {
    if (
      reference?.source !== 'controlled-external'
      || reference.independentFromCandidate !== true
      || !SAFE_ID.test(reference.participant ?? '')
      || !SAFE_ID.test(reference.evidenceId ?? '')
      || !Array.isArray(reference.runs)
    ) {
      throw new Error('GENERAL_AGENT_REFERENCE_PACK_ENTRY_INVALID');
    }
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function main(): Promise<void> {
  const candidateSha = requiredEnv('ORIGIN_GENERAL_AGENT_CANDIDATE_SHA').toLowerCase();
  const candidateArtifactDir = path.resolve(requiredEnv('ORIGIN_GENERAL_AGENT_CANDIDATE_ARTIFACT_DIR'));
  const corpusId = requiredEnv('ORIGIN_GENERAL_AGENT_CORPUS_ID');
  const evaluatorId = requiredEnv('ORIGIN_GENERAL_AGENT_EVALUATOR_ID');
  const roundId = requiredEnv('ORIGIN_GENERAL_AGENT_ROUND_ID');
  const encodedReferences = requiredEnv('ORIGIN_GENERAL_AGENT_REFERENCE_PACK_GZIP_B64');
  const outputDir = path.resolve(
    process.env.ORIGIN_GENERAL_AGENT_COMPARISON_OUTPUT_DIR
      ?? 'test-results/general-agent-trusted-comparison',
  );

  if (!SHA40.test(candidateSha)) throw new Error('GENERAL_AGENT_COMPARISON_CANDIDATE_SHA_INVALID');
  if (!SAFE_ID.test(corpusId)) throw new Error('GENERAL_AGENT_COMPARISON_CORPUS_ID_INVALID');
  if (!SAFE_ID.test(evaluatorId)) throw new Error('GENERAL_AGENT_COMPARISON_EVALUATOR_ID_INVALID');
  if (!SAFE_ID.test(roundId)) throw new Error('GENERAL_AGENT_COMPARISON_ROUND_ID_INVALID');

  const publicPacket = await readJson<CandidatePublicPacket>(
    path.join(candidateArtifactDir, 'public-tasks.json'),
  );
  const candidateEvidence = await readJson<GeneralAgentTrustedEvidenceV2[]>(
    path.join(candidateArtifactDir, 'candidate-trusted-evidence.json'),
  );
  assertCandidatePacket(publicPacket, candidateSha, corpusId);
  if (!Array.isArray(candidateEvidence) || candidateEvidence.length !== publicPacket.tasks.length) {
    throw new Error('GENERAL_AGENT_CANDIDATE_EVIDENCE_COUNT_INVALID');
  }

  const pack = parseReferencePack(encodedReferences);
  assertReferencePack(pack, publicPacket);

  const references: GeneralAgentTrustedReferenceEvidenceV2[] = pack.references.map(reference => ({
    source: 'controlled-external',
    independentFromCandidate: true,
    participant: reference.participant,
    permissionProfileDigest: publicPacket.permissionProfileDigest,
    evidenceId: reference.evidenceId,
    artifactDigest: digestGeneralAgentTrustedReferenceArtifactV2({
      participant: reference.participant,
      permissionProfileDigest: publicPacket.permissionProfileDigest,
      runs: reference.runs,
    }),
    createdAt: reference.createdAt,
    expiresAt: reference.expiresAt,
    runs: reference.runs,
  }));

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const roundEvidenceBase = {
    candidateSha,
    evaluatorId,
    permissionProfileDigest: publicPacket.permissionProfileDigest,
    tasks: publicPacket.tasks,
    candidateEvidence,
  };

  const input: GeneralAgentTrustedComparisonInputV2 = {
    version: GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2,
    candidateSha,
    tasks: publicPacket.tasks,
    roundEvidence: {
      source: 'evaluator',
      candidateSha,
      evaluatorId,
      permissionProfileDigest: publicPacket.permissionProfileDigest,
      evidenceId: `agent-round:${roundId}`,
      artifactDigest: digestGeneralAgentTrustedRoundArtifactV2(roundEvidenceBase),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    candidateEvidence,
    references,
  };

  const report = evaluateGeneralAgentTrustedComparisonV2(input, createdAt.getTime());

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, 'trusted-comparison-input.json'),
    JSON.stringify(input, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  );
  await fs.writeFile(
    path.join(outputDir, 'trusted-comparison-report.json'),
    JSON.stringify({
      schemaVersion: 'origin.general-agent-trusted-comparison-report.v1',
      corpusId: publicPacket.corpusId,
      corpusDigest: publicPacket.corpusDigest,
      candidateSha,
      evaluatorId,
      roundId,
      permissionProfileDigest: publicPacket.permissionProfileDigest,
      report,
    }, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  );

  process.stdout.write(JSON.stringify({
    event: 'general-agent-trusted-comparison-completed',
    corpusId: publicPacket.corpusId,
    corpusDigest: publicPacket.corpusDigest,
    candidateSha,
    evaluatorId,
    roundId,
    referenceCount: references.length,
    attempted: report.comparison?.attempted ?? publicPacket.tasks.length,
    solved: report.comparison?.solved ?? null,
    passed: report.passed,
    blockers: report.blockers,
  }) + '\n');

  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const safe = /^GENERAL_AGENT_[A-Z0-9_:-]{3,200}$/.test(message)
    ? message
    : 'GENERAL_AGENT_TRUSTED_COMPARISON_ASSEMBLY_FAILED';
  process.stderr.write(safe + '\n');
  process.exitCode = 1;
});
