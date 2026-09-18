import { containsSensitiveInput } from "./SensitiveInputDetector.js";
import { normalizeOriginPublicHttpsUrl } from "./OriginPublicSourceUrl.js";

export type OriginEvidenceSourceKind =
  | "user-provided"
  | "retrieved-public"
  | "connected-private"
  | "deterministic-tool"
  | "code-check"
  | "provider-output";

export type OriginEvidenceVerificationState =
  | "unverified"
  | "source-checked"
  | "claim-supported"
  | "verified";

export interface OriginEvidenceLedgerEntryInput {
  id: string;
  sourceKind: OriginEvidenceSourceKind;
  observedAt: string;
  label: string;
  sourceUrl?: string;
  sourceRef?: string;
  claimIds?: readonly string[];
  verificationState: OriginEvidenceVerificationState;
  costUsd: number;
  detail?: string;
}

export interface OriginEvidenceLedgerEntry extends OriginEvidenceLedgerEntryInput {
  readonly claimIds: readonly string[];
}

export interface OriginEvidenceLedger {
  readonly schemaVersion: "origin.evidence-ledger.v1";
  readonly entries: readonly OriginEvidenceLedgerEntry[];
  readonly totalCostUsd: number;
}

export type OriginEvidenceLedgerResult =
  | { ok: true; value: OriginEvidenceLedger }
  | { ok: false; code: "INVALID_EVIDENCE_LEDGER"; message: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_LABEL = 500;
const MAX_DETAIL = 2_000;
const MAX_ENTRIES = 128;
const MAX_CLAIMS_PER_ENTRY = 32;

function clean(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

function validRef(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 500 && !containsSensitiveInput(trimmed);
}

function validClaims(values: readonly string[] | undefined): values is readonly string[] {
  if (values === undefined) return true;
  if (values.length > MAX_CLAIMS_PER_ENTRY) return false;
  const seen = new Set<string>();
  for (const value of values) {
    if (!ID.test(value) || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

function normalizeEntry(input: OriginEvidenceLedgerEntryInput): OriginEvidenceLedgerEntry | null {
  if (!ID.test(input.id)) return null;
  if (!ISO_UTC.test(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) return null;
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0) return null;

  const label = clean(input.label, MAX_LABEL);
  const detail = clean(input.detail, MAX_DETAIL);
  if (!label || containsSensitiveInput(label) || (detail && containsSensitiveInput(detail))) return null;
  if (!validRef(input.sourceRef) || !validClaims(input.claimIds)) return null;

  let sourceUrl: string | undefined;
  if (input.sourceUrl !== undefined) {
    const normalizedSourceUrl = normalizeOriginPublicHttpsUrl(input.sourceUrl);
    if (!normalizedSourceUrl) return null;
    sourceUrl = normalizedSourceUrl;
  }

  if (input.sourceKind === "retrieved-public" && !sourceUrl) return null;
  if (input.sourceKind === "connected-private" && sourceUrl) return null;

  return Object.freeze({
    ...input,
    label,
    ...(detail ? { detail } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef.trim() } : {}),
    claimIds: Object.freeze([...(input.claimIds ?? [])]),
  });
}

export function createOriginEvidenceLedger(
  inputs: readonly OriginEvidenceLedgerEntryInput[],
): OriginEvidenceLedgerResult {
  if (inputs.length > MAX_ENTRIES) {
    return { ok: false, code: "INVALID_EVIDENCE_LEDGER", message: "Evidence ledger is invalid." };
  }

  const entries: OriginEvidenceLedgerEntry[] = [];
  const ids = new Set<string>();
  let totalCostUsd = 0;

  for (const input of inputs) {
    if (ids.has(input.id)) {
      return { ok: false, code: "INVALID_EVIDENCE_LEDGER", message: "Evidence ledger is invalid." };
    }
    const entry = normalizeEntry(input);
    if (!entry) {
      return { ok: false, code: "INVALID_EVIDENCE_LEDGER", message: "Evidence ledger is invalid." };
    }
    ids.add(entry.id);
    entries.push(entry);
    totalCostUsd += entry.costUsd;
  }

  if (!Number.isFinite(totalCostUsd)) {
    return { ok: false, code: "INVALID_EVIDENCE_LEDGER", message: "Evidence ledger is invalid." };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.evidence-ledger.v1",
      entries: Object.freeze([...entries]),
      totalCostUsd,
    }),
  };
}

export function appendOriginEvidence(
  ledger: OriginEvidenceLedger,
  entry: OriginEvidenceLedgerEntryInput,
): OriginEvidenceLedgerResult {
  return createOriginEvidenceLedger([...ledger.entries, entry]);
}
