import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  ORIGIN_AQ_V2_FAMILIES,
  validateOriginAnswerExperienceManifestV2,
  type OriginAnswerExperienceFamilyV2,
  type OriginAnswerExperienceManifestV2,
} from "./OriginAnswerExperienceV2.js";

export const ORIGIN_AQ_V2_SEALED_CORPUS_VERSION = "origin.aq-v2.sealed-corpus.v1" as const;

export interface OriginAnswerExperiencePrivateCaseV2 {
  readonly caseId: string;
  readonly family: OriginAnswerExperienceFamilyV2;
  readonly prompt: string;
  readonly evaluatorNotes: string;
}

export interface OriginAnswerExperienceSealedCorpusV2 {
  readonly schemaVersion: typeof ORIGIN_AQ_V2_SEALED_CORPUS_VERSION;
  readonly corpusId: string;
  readonly cases: readonly OriginAnswerExperiencePrivateCaseV2[];
}

export interface OriginAnswerExperiencePreparedCorpusV2 {
  readonly publicManifest: OriginAnswerExperienceManifestV2;
  readonly corpusDigest: string;
  readonly privateCorpus: OriginAnswerExperienceSealedCorpusV2;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + stable(record[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value), "utf8").digest("hex");
}

function validText(value: string, max: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validatePrivateCorpus(corpus: OriginAnswerExperienceSealedCorpusV2): void {
  if (corpus.schemaVersion !== ORIGIN_AQ_V2_SEALED_CORPUS_VERSION) throw new Error("AQ_V2_SEALED_VERSION_INVALID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(corpus.corpusId)) throw new Error("AQ_V2_SEALED_ID_INVALID");
  if (corpus.cases.length !== ORIGIN_AQ_V2_FAMILIES.length * 3) throw new Error("AQ_V2_SEALED_SHAPE_INVALID");

  const ids = new Set<string>();
  for (const item of corpus.cases) {
    if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(item.caseId) || ids.has(item.caseId)) {
      throw new Error("AQ_V2_SEALED_CASE_INVALID");
    }
    ids.add(item.caseId);
    if (!ORIGIN_AQ_V2_FAMILIES.includes(item.family)) throw new Error("AQ_V2_SEALED_FAMILY_INVALID");
    if (!validText(item.prompt, 24_000)) throw new Error("AQ_V2_SEALED_PROMPT_INVALID");
    if (!validText(item.evaluatorNotes, 12_000)) throw new Error("AQ_V2_SEALED_NOTES_INVALID");
  }
}

export function prepareOriginAnswerExperienceSealedCorpusV2(
  corpus: OriginAnswerExperienceSealedCorpusV2,
): OriginAnswerExperiencePreparedCorpusV2 {
  validatePrivateCorpus(corpus);
  const publicManifest: OriginAnswerExperienceManifestV2 = Object.freeze({
    schemaVersion: "origin.answer-experience-manifest.v2",
    cases: Object.freeze(corpus.cases.map(item => Object.freeze({
      caseId: item.caseId,
      family: item.family,
    }))),
  });
  if (!validateOriginAnswerExperienceManifestV2(publicManifest)) throw new Error("AQ_V2_SEALED_MANIFEST_INVALID");

  return Object.freeze({
    publicManifest,
    corpusDigest: digest(corpus),
    privateCorpus: corpus,
  });
}

export function parseOriginAnswerExperienceSealedCorpusGzipBase64V2(
  encoded: string,
): OriginAnswerExperiencePreparedCorpusV2 {
  if (!encoded || encoded.length > 2_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("AQ_V2_SEALED_ENCODING_INVALID");
  }
  let parsed: unknown;
  try {
    const raw = gunzipSync(Buffer.from(encoded, "base64"), { maxOutputLength: 2_000_000 }).toString("utf8");
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AQ_V2_SEALED_PARSE_FAILED");
  }
  return prepareOriginAnswerExperienceSealedCorpusV2(parsed as OriginAnswerExperienceSealedCorpusV2);
}

export function publicOriginAnswerExperienceCorpusEvidenceV2(
  prepared: OriginAnswerExperiencePreparedCorpusV2,
) {
  return Object.freeze({
    schemaVersion: "origin.answer-experience-public-corpus.v2",
    corpusDigest: prepared.corpusDigest,
    manifest: prepared.publicManifest,
  });
}
