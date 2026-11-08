import { Pool, type QueryResult } from 'pg';
import {
  AGENT_RUN_ID_PATTERN,
  AGENT_RUN_OWNER_BINDING_PATTERN,
  assertAgentRunStatusTransition,
  isAgentRunRecordStatus,
  normalizeAgentRunApprovalDeadlineAt,
  normalizeAgentRunGoal,
  normalizeAgentRunHold,
  normalizeAgentRunPlan,
  normalizeAgentRunPlanDigest,
  normalizeAgentRunPriorResumeAttempts,
  normalizeAgentRunPriority,
  normalizeAgentRunQuotaLedger,
  normalizeAgentRunStepsState,
  validateCreateAgentRunInput,
  type AgentRunFinishStatus,
  type AgentRunHold,
  type AgentRunLeaseRecord,
  type AgentRunProgressPatch,
  type AgentRunRecord,
  type AgentRunRecordStatus,
  type AgentRunStore,
  type CreateAgentRunInput,
  type ListAgentRunsByOwnerOptions,
  type TransitionAgentRunInput,
} from './agentRunRecord.js';

export const AGENT_RUN_MIN_LEASE_SECONDS = 30;
export const AGENT_RUN_MAX_LEASE_SECONDS = 300;
const DRIVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const MAX_EXPIRY_SWEEP = 1000;

type DbRow = Record<string, unknown>;
export interface AgentRunSqlExecutor {
  query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

const RECORD_RETURNING = `run_id, owner_binding, goal, status, plan, plan_digest,
  steps_state, parent_run_id, priority, hold, quota_ledger, prior_resume_attempts,
  floor(extract(epoch from approval_deadline_at) * 1000)::text as approval_deadline_ms,
  version,
  floor(extract(epoch from created_at) * 1000)::text as created_ms,
  floor(extract(epoch from updated_at) * 1000)::text as updated_ms,
  floor(extract(epoch from expires_at) * 1000)::text as expires_ms`;
const LEASE_RETURNING = `${RECORD_RETURNING}, driver_id,
  floor(extract(epoch from lease_expires_at) * 1000)::text as lease_ms`;

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

function validDriverId(value: unknown): value is string {
  return typeof value === 'string' && DRIVER_ID_PATTERN.test(value);
}

function validLeaseSeconds(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= AGENT_RUN_MIN_LEASE_SECONDS && Number(value) <= AGENT_RUN_MAX_LEASE_SECONDS;
}

function milliseconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  return parsed;
}

function nullableMilliseconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return milliseconds(value);
}

function parseJsonb<T>(value: unknown, normalize: (raw: never) => T): T {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new Error('AGENT_RUN_DB_ROW_INVALID');
    }
  }
  try {
    return normalize(parsed as never);
  } catch {
    throw new Error('AGENT_RUN_DB_ROW_INVALID');
  }
}

function parseRecord(row: DbRow): AgentRunRecord {
  const runId = row.run_id;
  const ownerBinding = row.owner_binding;
  const status = row.status;
  if (typeof runId !== 'string' || !AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  if (typeof ownerBinding !== 'string' || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  if (!isAgentRunRecordStatus(status)) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  let goal: string;
  try {
    goal = normalizeAgentRunGoal(row.goal);
  } catch {
    throw new Error('AGENT_RUN_DB_ROW_INVALID');
  }
  const plan = parseJsonb(row.plan, (raw) => normalizeAgentRunPlan(raw));
  let planDigest: string | null;
  try {
    planDigest = normalizeAgentRunPlanDigest(row.plan_digest as string | null | undefined);
  } catch {
    throw new Error('AGENT_RUN_DB_ROW_INVALID');
  }
  if ((plan === null) !== (planDigest === null)) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  const stepsState = parseJsonb(row.steps_state, (raw) => normalizeAgentRunStepsState(raw));
  const hold = parseJsonb(row.hold, (raw) => normalizeAgentRunHold(raw));
  if ((status === 'held') !== (hold !== null)) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  // The approval deadline exists exactly while awaiting approval (the
  // lifecycle the migration's check constraint enforces), and the
  // carried resume-attempt count mirrors the current hold while held.
  const approvalDeadlineAt = nullableMilliseconds(row.approval_deadline_ms);
  if ((status === 'awaiting_approval') !== (approvalDeadlineAt !== null)) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  let priorResumeAttempts: number | null;
  try {
    priorResumeAttempts = normalizeAgentRunPriorResumeAttempts(row.prior_resume_attempts);
  } catch {
    throw new Error('AGENT_RUN_DB_ROW_INVALID');
  }
  if (status === 'held' && priorResumeAttempts !== hold?.resumeAttempts) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  const quotaLedger = parseJsonb(row.quota_ledger, (raw) => normalizeAgentRunQuotaLedger(raw));
  let parentRunId: string | null = null;
  if (row.parent_run_id !== null) {
    if (typeof row.parent_run_id !== 'string' || !AGENT_RUN_ID_PATTERN.test(row.parent_run_id) || row.parent_run_id === runId) {
      throw new Error('AGENT_RUN_DB_ROW_INVALID');
    }
    parentRunId = row.parent_run_id;
  }
  let priority: number;
  try {
    priority = normalizeAgentRunPriority(Number(row.priority));
  } catch {
    throw new Error('AGENT_RUN_DB_ROW_INVALID');
  }
  const version = Number(row.version);
  if (!Number.isInteger(version) || version < 1) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  return {
    runId,
    ownerBinding,
    goal,
    status,
    plan,
    planDigest,
    stepsState,
    parentRunId,
    priority,
    hold,
    quotaLedger,
    approvalDeadlineAt,
    priorResumeAttempts,
    version,
    createdAt: milliseconds(row.created_ms),
    updatedAt: milliseconds(row.updated_ms),
    expiresAt: milliseconds(row.expires_ms),
  };
}

function parseLeaseRecord(row: DbRow): AgentRunLeaseRecord {
  const record = parseRecord(row);
  const driverId = row.driver_id;
  if (!validDriverId(driverId)) throw new Error('AGENT_RUN_DB_ROW_INVALID');
  return { ...record, driverId, leaseExpiresAt: milliseconds(row.lease_ms) };
}

function jsonParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/**
 * Postgres-backed AgentRunStore following the same implementation style as
 * the run consumption store and the V1.4 coding job store: parameterized
 * SQL only, conditional updates for every state change, optimistic locking
 * via `version`, and lease-based claiming for drivers.
 */
export class PostgresAgentRunStore implements AgentRunStore {
  constructor(private readonly database: AgentRunSqlExecutor) {}

  async create(input: CreateAgentRunInput, now = Date.now()): Promise<AgentRunRecord | null> {
    const normalized = validateCreateAgentRunInput(input, now);
    const result = await this.database.query(
      `insert into public.origin_agent_runs
        (run_id, owner_binding, goal, status, plan, plan_digest, steps_state,
         parent_run_id, priority, hold, quota_ledger, approval_deadline_at,
         prior_resume_attempts, expires_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb,
         case when $12 is null then null else to_timestamp($12 / 1000.0) end, $13,
         to_timestamp($14 / 1000.0))
       on conflict (run_id) do nothing
       returning ${RECORD_RETURNING}`,
      [
        normalized.runId,
        normalized.ownerBinding,
        normalized.goal,
        normalized.status,
        jsonParam(normalized.plan),
        normalized.planDigest,
        JSON.stringify(normalized.stepsState),
        normalized.parentRunId,
        normalized.priority,
        jsonParam(normalized.hold),
        JSON.stringify(normalized.quotaLedger),
        normalized.approvalDeadlineAt,
        normalized.priorResumeAttempts,
        normalized.expiresAt,
      ],
    );
    return result.rows[0] ? parseRecord(result.rows[0]) : null;
  }

  async get(runId: string, ownerBinding: string): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return null;
    const result = await this.database.query(
      `select ${RECORD_RETURNING}
       from public.origin_agent_runs
       where run_id = $1 and owner_binding = $2 and expires_at > clock_timestamp()
       limit 1`,
      [runId, ownerBinding],
    );
    return result.rows[0] ? parseRecord(result.rows[0]) : null;
  }

  async listByOwner(ownerBinding: string, options: ListAgentRunsByOwnerOptions = {}): Promise<AgentRunRecord[]> {
    if (!AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return [];
    const limit = options.limit === undefined ? DEFAULT_LIST_LIMIT : options.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new Error('AGENT_RUN_LIST_INPUT_INVALID');
    const statuses = options.statuses;
    if (statuses !== undefined && (!Array.isArray(statuses) || statuses.length === 0 || statuses.some((s) => !isAgentRunRecordStatus(s)))) {
      throw new Error('AGENT_RUN_LIST_INPUT_INVALID');
    }
    const result = statuses === undefined
      ? await this.database.query(
        `select ${RECORD_RETURNING}
         from public.origin_agent_runs
         where owner_binding = $1 and expires_at > clock_timestamp()
         order by priority desc, created_at desc
         limit $2`,
        [ownerBinding, limit],
      )
      : await this.database.query(
        `select ${RECORD_RETURNING}
         from public.origin_agent_runs
         where owner_binding = $1 and expires_at > clock_timestamp() and status = any($2::text[])
         order by priority desc, created_at desc
         limit $3`,
        [ownerBinding, [...statuses], limit],
      );
    return result.rows.map((row) => parseRecord(row));
  }

  async transition(input: TransitionAgentRunInput): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(input.runId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(input.ownerBinding)) return null;
    if (!isAgentRunRecordStatus(input.expectedStatus) || !isAgentRunRecordStatus(input.nextStatus)) {
      throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    }
    assertAgentRunStatusTransition(input.expectedStatus, input.nextStatus);
    // `running` is entered only through the lease-based claim, and `expired`
    // only through the expiry sweep, so neither is a valid target here.
    if (input.nextStatus === 'running' || input.nextStatus === 'expired') {
      throw new Error('AGENT_RUN_TRANSITION_DENIED');
    }
    const hasPlan = input.plan !== undefined || input.planDigest !== undefined;
    let planJson: string | null = null;
    let planDigest: string | null = null;
    if (hasPlan) {
      const plan = normalizeAgentRunPlan(input.plan);
      planDigest = normalizeAgentRunPlanDigest(input.planDigest);
      if ((plan === null) !== (planDigest === null)) throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
      planJson = jsonParam(plan);
    }
    const hasStepsState = input.stepsState !== undefined;
    const stepsStateJson = hasStepsState ? JSON.stringify(normalizeAgentRunStepsState(input.stepsState)) : null;
    const hasLedger = input.quotaLedger !== undefined;
    const ledgerJson = hasLedger ? JSON.stringify(normalizeAgentRunQuotaLedger(input.quotaLedger)) : null;
    const hasPriority = input.priority !== undefined;
    const priority = hasPriority ? normalizeAgentRunPriority(input.priority) : null;
    let holdJson: string | null = null;
    let holdResumeAttempts: number | null = null;
    if (input.nextStatus === 'held') {
      const hold = normalizeAgentRunHold(input.hold);
      if (hold === null) throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
      holdJson = JSON.stringify(hold);
      // The carried count follows the hold being written, so a later
      // re-hold can seed from it (design §8.6).
      holdResumeAttempts = hold.resumeAttempts;
    } else if (input.hold !== undefined && input.hold !== null) {
      // Hold information may only exist on held records.
      throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    }
    // The approval deadline is set exactly when entering
    // `awaiting_approval` and cleared when leaving it, mirroring hold.
    let approvalDeadlineMs: number | null = null;
    if (input.nextStatus === 'awaiting_approval') {
      if (input.approvalDeadlineAt === undefined || input.approvalDeadlineAt === null) {
        throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
      }
      try {
        approvalDeadlineMs = normalizeAgentRunApprovalDeadlineAt(input.approvalDeadlineAt, Date.now());
      } catch {
        throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
      }
    } else if (input.approvalDeadlineAt !== undefined && input.approvalDeadlineAt !== null) {
      throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    }
    const result = await this.database.query(
      `update public.origin_agent_runs
       set status = $3,
           plan = case when $4 then $5::jsonb else plan end,
           plan_digest = case when $4 then $6 else plan_digest end,
           steps_state = case when $7 then $8::jsonb else steps_state end,
           quota_ledger = case when $9 then $10::jsonb else quota_ledger end,
           priority = case when $11 then $12 else priority end,
           hold = case
             when $3 = 'held' then $13::jsonb
             when $14 = 'held' then null
             else hold
           end,
           prior_resume_attempts = case
             when $3 = 'held' then $16
             else prior_resume_attempts
           end,
           approval_deadline_at = case
             when $3 = 'awaiting_approval' then to_timestamp($17 / 1000.0)
             when $14 = 'awaiting_approval' then null
             else approval_deadline_at
           end,
           driver_id = case when status = 'running' then null else driver_id end,
           lease_expires_at = case when status = 'running' then null else lease_expires_at end,
           updated_at = clock_timestamp(), version = version + 1
       where run_id = $1 and owner_binding = $2 and status = $14 and version = $15
         and expires_at > clock_timestamp()
       returning ${RECORD_RETURNING}`,
      [
        input.runId,
        input.ownerBinding,
        input.nextStatus,
        hasPlan,
        planJson,
        planDigest,
        hasStepsState,
        stepsStateJson,
        hasLedger,
        ledgerJson,
        hasPriority,
        priority,
        holdJson,
        input.expectedStatus,
        input.expectedVersion,
        holdResumeAttempts,
        approvalDeadlineMs,
      ],
    );
    return result.rows[0] ? parseRecord(result.rows[0]) : null;
  }

  async refreshApprovalDeadline(runId: string, ownerBinding: string, approvalDeadlineAt: number): Promise<boolean> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return false;
    const deadline = normalizeAgentRunApprovalDeadlineAt(approvalDeadlineAt, Date.now());
    const result = await this.database.query(
      `update public.origin_agent_runs
       set approval_deadline_at = to_timestamp($3 / 1000.0)
       where run_id = $1 and owner_binding = $2 and status = 'awaiting_approval'
         and expires_at > clock_timestamp()
       returning run_id`,
      [runId, ownerBinding, deadline],
    );
    return result.rowCount === 1;
  }

  async claim(runId: string, driverId: string, leaseSeconds: number): Promise<AgentRunLeaseRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !validDriverId(driverId) || !validLeaseSeconds(leaseSeconds)) {
      throw new Error('AGENT_RUN_CLAIM_INPUT_INVALID');
    }
    const result = await this.database.query(
      `update public.origin_agent_runs
       set status = 'running', driver_id = $2,
           lease_expires_at = clock_timestamp() + ($3 * interval '1 second'),
           updated_at = clock_timestamp(), version = version + 1
       where run_id = $1 and expires_at > clock_timestamp()
         and (
           status = 'queued'
           or (status = 'running' and lease_expires_at <= clock_timestamp())
         )
       returning ${LEASE_RETURNING}`,
      [runId, driverId, leaseSeconds],
    );
    return result.rows[0] ? parseLeaseRecord(result.rows[0]) : null;
  }

  async renewLease(runId: string, driverId: string, leaseSeconds: number): Promise<boolean> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !validDriverId(driverId) || !validLeaseSeconds(leaseSeconds)) {
      throw new Error('AGENT_RUN_CLAIM_INPUT_INVALID');
    }
    const result = await this.database.query(
      `update public.origin_agent_runs
       set lease_expires_at = clock_timestamp() + ($3 * interval '1 second'),
           updated_at = clock_timestamp(), version = version + 1
       where run_id = $1 and driver_id = $2 and status = 'running'
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
       returning run_id`,
      [runId, driverId, leaseSeconds],
    );
    return result.rowCount === 1;
  }

  async updateProgress(runId: string, driverId: string, patch: AgentRunProgressPatch): Promise<boolean> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !validDriverId(driverId)) throw new Error('AGENT_RUN_PROGRESS_INPUT_INVALID');
    const hasStepsState = patch.stepsState !== undefined;
    const hasLedger = patch.quotaLedger !== undefined;
    if (!hasStepsState && !hasLedger) throw new Error('AGENT_RUN_PROGRESS_INPUT_INVALID');
    const stepsStateJson = hasStepsState ? JSON.stringify(normalizeAgentRunStepsState(patch.stepsState)) : null;
    const ledgerJson = hasLedger ? JSON.stringify(normalizeAgentRunQuotaLedger(patch.quotaLedger)) : null;
    const result = await this.database.query(
      `update public.origin_agent_runs
       set steps_state = case when $3 then $4::jsonb else steps_state end,
           quota_ledger = case when $5 then $6::jsonb else quota_ledger end,
           updated_at = clock_timestamp(), version = version + 1
       where run_id = $1 and driver_id = $2 and status = 'running'
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
       returning run_id`,
      [runId, driverId, hasStepsState, stepsStateJson, hasLedger, ledgerJson],
    );
    return result.rowCount === 1;
  }

  async finish(
    runId: string,
    driverId: string,
    nextStatus: AgentRunFinishStatus,
    hold?: AgentRunHold | null,
  ): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !validDriverId(driverId)) throw new Error('AGENT_RUN_FINISH_INPUT_INVALID');
    assertAgentRunStatusTransition('running', nextStatus);
    let holdJson: string | null = null;
    let holdResumeAttempts: number | null = null;
    if (nextStatus === 'held') {
      const normalizedHold = normalizeAgentRunHold(hold);
      if (normalizedHold === null) throw new Error('AGENT_RUN_FINISH_INPUT_INVALID');
      holdJson = JSON.stringify(normalizedHold);
      holdResumeAttempts = normalizedHold.resumeAttempts;
    } else if (hold !== undefined && hold !== null) {
      throw new Error('AGENT_RUN_FINISH_INPUT_INVALID');
    }
    const result = await this.database.query(
      `update public.origin_agent_runs
       set status = $3, hold = $4::jsonb,
           prior_resume_attempts = case when $3 = 'held' then $5 else prior_resume_attempts end,
           driver_id = null, lease_expires_at = null,
           updated_at = clock_timestamp(), version = version + 1
       where run_id = $1 and driver_id = $2 and status = 'running'
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
       returning ${RECORD_RETURNING}`,
      [runId, driverId, nextStatus, holdJson, holdResumeAttempts],
    );
    return result.rows[0] ? parseRecord(result.rows[0]) : null;
  }

  async recoverStale(runId: string): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId)) return null;
    const result = await this.database.query(
      `update public.origin_agent_runs
       set status = 'queued', driver_id = null, lease_expires_at = null,
           updated_at = clock_timestamp(), version = version + 1
       where run_id = $1 and status = 'running' and lease_expires_at <= clock_timestamp()
         and expires_at > clock_timestamp()
       returning ${RECORD_RETURNING}`,
      [runId],
    );
    return result.rows[0] ? parseRecord(result.rows[0]) : null;
  }

  async markExpired(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPIRY_SWEEP) throw new Error('AGENT_RUN_CLEANUP_LIMIT_INVALID');
    const result = await this.database.query(
      `with due as (
         select ctid from public.origin_agent_runs
         where expires_at <= clock_timestamp()
           and status not in ('completed', 'failed', 'cancelled', 'expired')
         order by expires_at asc limit $1
       )
       update public.origin_agent_runs r
       set status = 'expired', hold = null, approval_deadline_at = null,
           driver_id = null, lease_expires_at = null,
           updated_at = clock_timestamp(), version = r.version + 1
       from due
       where r.ctid = due.ctid
       returning r.run_id`,
      [limit],
    );
    return result.rowCount ?? result.rows.length;
  }
}

export function createAgentRunStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PostgresAgentRunStore | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  });
  return new PostgresAgentRunStore(pool);
}
