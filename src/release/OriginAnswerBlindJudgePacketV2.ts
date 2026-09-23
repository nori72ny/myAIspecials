import { createHash } from "node:crypto";

export interface OriginBlindAnswerSourceV2 {
  readonly sourceId: string;
  readonly answer: string;
}

export interface OriginBlindJudgePacketV2 {
  readonly schemaVersion: "origin.aq-v2.blind-judge-packet.v1";
  readonly pairId: string;
  readonly caseId: string;
  readonly prompt: string;
  readonly answerA: string;
  readonly answerB: string;
}

export interface OriginBlindJudgeKeyV2 {
  readonly schemaVersion: "origin.aq-v2.blind-judge-key.v1";
  readonly pairId: string;
  readonly caseId: string;
  readonly answerASourceId: string;
  readonly answerBSourceId: string;
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/.test(value);
}

function nonEmptyText(value: string, max: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function orderBit(caseId: string, leftId: string, rightId: string, salt: string): 0 | 1 {
  const digest = createHash("sha256")
    .update(`${caseId}\n${leftId}\n${rightId}\n${salt}`, "utf8")
    .digest();
  return (digest[0] & 1) as 0 | 1;
}

export function buildOriginBlindJudgePacketV2(input: {
  readonly caseId: string;
  readonly prompt: string;
  readonly candidate: OriginBlindAnswerSourceV2;
  readonly reference: OriginBlindAnswerSourceV2;
  readonly salt: string;
}): {
  readonly packet: OriginBlindJudgePacketV2;
  readonly key: OriginBlindJudgeKeyV2;
} {
  if (
    !validId(input.caseId)
    || !validId(input.candidate.sourceId)
    || !validId(input.reference.sourceId)
    || input.candidate.sourceId === input.reference.sourceId
    || !nonEmptyText(input.prompt, 24_000)
    || !nonEmptyText(input.candidate.answer, 120_000)
    || !nonEmptyText(input.reference.answer, 120_000)
    || !nonEmptyText(input.salt, 256)
  ) {
    throw new Error("AQ_V2_BLIND_PACKET_INVALID");
  }

  const swapped = orderBit(
    input.caseId,
    input.candidate.sourceId,
    input.reference.sourceId,
    input.salt,
  ) === 1;

  const answerA = swapped ? input.reference : input.candidate;
  const answerB = swapped ? input.candidate : input.reference;
  const pairId = createHash("sha256")
    .update(`${input.caseId}\n${input.candidate.sourceId}\n${input.reference.sourceId}\n${input.salt}`, "utf8")
    .digest("hex")
    .slice(0, 24);

  return Object.freeze({
    packet: Object.freeze({
      schemaVersion: "origin.aq-v2.blind-judge-packet.v1",
      pairId,
      caseId: input.caseId,
      prompt: input.prompt,
      answerA: answerA.answer,
      answerB: answerB.answer,
    }),
    key: Object.freeze({
      schemaVersion: "origin.aq-v2.blind-judge-key.v1",
      pairId,
      caseId: input.caseId,
      answerASourceId: answerA.sourceId,
      answerBSourceId: answerB.sourceId,
    }),
  });
}

export function assertOriginBlindPacketDoesNotRevealSourceV2(
  packet: OriginBlindJudgePacketV2,
  forbiddenSourceIds: readonly string[],
): void {
  const serialized = JSON.stringify(packet).toLowerCase();
  for (const sourceId of forbiddenSourceIds) {
    if (sourceId.trim() && serialized.includes(sourceId.toLowerCase())) {
      throw new Error("AQ_V2_BLIND_SOURCE_ID_LEAK");
    }
  }
}
