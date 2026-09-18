import type { QueryResult } from "pg";
import { containsSensitiveInput } from "../lib/orchestration/SensitiveInputDetector.js";

export type OriginTraceVerificationStatus =
  | "not-required"
  | "not-run"
  | "passed"
  | "failed"
  | "blocked";

export type OriginTraceOutcome =
  | "success"
  | "blocked"
  | "provider-failure"
  | "policy-rejected"
  | "invalid-response";

export interface OriginExecutionTraceRecordV1 {
  traceId: string;
  route: string;
  taskType: string;
  verificationStatus: OriginTraceVerificationStatus;
  reviewRequired: boolean;
  independentReviewPerformed: boolean;
  providerId?: string;
  modelId?: string;
  freeOnly: true;
  actualCostUsd: 0;
  outcome: OriginTraceOutcome;
  failureCode?: string;
  includedMessageCount: number;
  includedCharacterCount: number;
  omittedMessageCount: number;
  omittedCharacterCount: number;
  createdAt: number;
  expiresAt: number;
}

type DbRow = Record<string, unknown>;

export interface OriginTraceSqlExecutorV1 {
  query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

const TRACE_ID = /^origin-[A-Za-z0-9._:-]{8,180}$/;
const ROUTE = /^\/[A-Za-z0-9._/-]{1,120}$/;
const TASK_TYPE = /^[a-z][a-z0-9-]{1,63}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{1,120}$/;
const MAX_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const MIN_RETENTION_MS = 60 * 60 * 1000;

function boundedInt(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validOptionalId(value: string | undefined, pattern: RegExp): boolean {
  return value === undefined || (pattern.test(value) && !containsSensitiveInput(value));
}

export function validateOriginExecutionTraceRecordV1(
  record: OriginExecutionTraceRecordV1,
): boolean {
  if (
    !TRACE_ID.test(record.traceId)
    || !ROUTE.test(record.route)
    || !TASK_TYPE.test(record.taskType)
    || !validOptionalId(record.providerId, PROVIDER_ID)
    || !validOptionalId(record.modelId, MODEL_ID)
    || (record.failureCode !== undefined && !FAILURE_CODE.test(record.failureCode))
    || record.freeOnly !== true
    || record.actualCostUsd !== 0
  ) return false;

  if (
    !boundedInt(record.includedMessageCount, 0, 256)
    || !boundedInt(record.includedCharacterCount, 0, 200_000)
    || !boundedInt(record.omittedMessageCount, 0, 100_000)
    || !boundedInt(record.omittedCharacterCount, 0, 100_000_000)
  ) return false;

  if (
    !Number.isFinite(record.createdAt)
    || !Number.isFinite(record.expiresAt)
    || record.expiresAt < record.createdAt + MIN_RETENTION_MS
    || record.expiresAt > record.createdAt + MAX_RETENTION_MS
  ) return false;

  if (record.verificationStatus === "passed" && !record.independentReviewPerformed) return false;
  if (record.independentReviewPerformed && record.verificationStatus !== "passed") return false;
  return true;
}

export class PostgresOriginExecutionTraceStoreV1 {
  constructor(private readonly database: OriginTraceSqlExecutorV1) {}

  async append(record: OriginExecutionTraceRecordV1): Promise<boolean> {
    if (!validateOriginExecutionTraceRecordV1(record)) {
      throw new Error("ORIGIN_TRACE_RECORD_INVALID");
    }

    const result = await this.database.query(
      `insert into public.origin_execution_traces_v1
        (trace_id, route, task_type, verification_status, review_required,
         independent_review_performed, provider_id, model_id, free_only,
         actual_cost_usd, outcome, failure_code,
         included_message_count, included_character_count,
         omitted_message_count, omitted_character_count, created_at, expires_at)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,true,0,$9,$10,$11,$12,$13,$14,
         to_timestamp($15 / 1000.0), to_timestamp($16 / 1000.0))
       on conflict (trace_id) do nothing
       returning trace_id`,
      [
        record.traceId,
        record.route,
        record.taskType,
        record.verificationStatus,
        record.reviewRequired,
        record.independentReviewPerformed,
        record.providerId ?? null,
        record.modelId ?? null,
        record.outcome,
        record.failureCode ?? null,
        record.includedMessageCount,
        record.includedCharacterCount,
        record.omittedMessageCount,
        record.omittedCharacterCount,
        record.createdAt,
        record.expiresAt,
      ],
    );

    return result.rowCount === 1;
  }

  async deleteExpired(limit = 500): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("ORIGIN_TRACE_CLEANUP_LIMIT_INVALID");
    }

    const result = await this.database.query(
      `with expired as (
         select ctid from public.origin_execution_traces_v1
         where expires_at <= clock_timestamp()
         order by expires_at asc
         limit $1
       )
       delete from public.origin_execution_traces_v1
       where ctid in (select ctid from expired)`,
      [limit],
    );
    return result.rowCount ?? 0;
  }
}
