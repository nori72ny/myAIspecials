import { MAX_PLAN_STEPS, type AgentToolStepV3 } from './agentToolPlannerV3.js';
import type { ToolParams } from './toolRegistry.js';
import {
  AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS,
  AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN,
  AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP,
  type AgentAttachmentDataView,
} from './agentAttachmentData.js';
import type { AgentDataOutputKind } from './agentAttachmentTools.js';

/**
 * Plan augmentation for attachment-bound goals (agent file-input
 * foundation, F2; design AGENT_FILE_INPUT_DESIGN_2026-11-18 §3.6).
 *
 * The deterministic planner knows nothing about attachments, and with
 * no attachment this module is never called — plans stay byte-identical
 * to the pre-foundation shape. When a set is bound, the plan is
 * augmented deterministically:
 *
 * 1. `attachment_reader` leads the plan.
 * 2. One or more `attachment_analyzer` steps (at most 8 chunks each,
 *    chained by `contentFromStep` so their bundles merge) sit
 *    immediately before the first generative step — or close the plan
 *    when the goal has no generative step, making the analyzer's
 *    bundle the run's final artifact (design J1(a)).
 * 3. That first generative step is re-grounded on the analyzer:
 *    document_generator gains `dataGrounded: true` (its template
 *    fallback is disabled) and `contentFromStep` naming the last
 *    analyzer step; file_writer keeps only its path and takes its
 *    content from the analyzer, so the goal-derived sample CSV /
 *    draft markdown the param generator fabricates can never become
 *    the written file.
 * 4. Goal-derived file paths are confined. The base planner and its
 *    param generator treat backtick-quoted or path-like goal tokens
 *    as file paths — a Kubernetes Deployment named `payment-api`
 *    became a file_reader path in production and blocked the run at
 *    execution. In an attachment-bound plan the only files that exist
 *    are the set's, so a file_reader step survives only when its path
 *    names a set file (the attachment_reader already covers the set's
 *    contents, so dropping loses nothing), and a file_writer step
 *    keeps only a set-file path or an artifacts/ path — the namespace
 *    every system-generated output path uses. Any other goal-derived
 *    writer path is replaced with the default attachment-result
 *    artifact; its content chaining is untouched, so the deliverable
 *    still comes from the analyzer or the preceding document.
 *
 * Every data step carries `{ attachmentSetId, setDigest }`, so the
 * canonical params digest binds the set's exact contents into the
 * approval, exactly as F1 established. The key column is never a plan
 * param (design §3.6.4): what the human approves is which data and
 * what operation, not a guessed column name.
 *
 * Oversize is refused here, at plan time, with the counts attached
 * (design §4.3): a set needing more than 48 chunks, or a plan that
 * cannot fit the step ceiling, never starts executing. The refusal
 * names the constraint that actually fired (`limitKind`, with `limit`
 * set to that constraint's bound) — until 2026-11-21 the step branch
 * also reported the 48-chunk constant, which misdirected triage when
 * mid-size sets (17 chunks) were refused on steps alone.
 */

export type AgentStepInputLike = { toolName: AgentToolStepV3['toolName']; params: ToolParams };

/**
 * The step ceiling for an attachment-bound plan, derived from the
 * constants that bound its parts: the largest base plan the planner
 * can emit (MAX_PLAN_STEPS) + the reader + one analyzer per
 * AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP chunks of the largest
 * admissible set — 6 + 1 + ceil(48 / 8) = 13. Any set within the
 * attachment limits can therefore always form a plan, while the
 * ceiling stays a hard bound (and below the 20-step record ceiling).
 * The executor's step-input validation uses this same constant for
 * attachment-bound step lists, so an issuable plan is always an
 * executable one. (The flat MAX_EXECUTION_STEPS of 6 that this
 * replaces made mid-size sets unplannable: a 17-chunk set already
 * needs reader + 3 analyzers on top of the goal's base steps.)
 */
export const AGENT_ATTACHMENT_MAX_PLAN_STEPS =
  MAX_PLAN_STEPS + 1 + Math.ceil(AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN / AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP);

const GENERATIVE_TOOLS: ReadonlySet<string> = new Set(['document_generator', 'file_writer']);

const ROWS_INTENT_PATTERN = /分類|抽出|集計|一覧化|\bclassif|\bextract|\btabulat/i;
const FINDINGS_INTENT_PATTERN = /照合|監査|分析|原因|不整合|チェック|\baudit|\bconsisten|\banaly[sz]|\binvestigat|root\s*cause/i;

/** The plan-time output-kind decision (design §3.6.4): a deterministic
 * reading of the goal text — classification/extraction goals produce
 * rows, audit/analysis goals produce findings, everything else text. */
export function attachmentOutputKindForGoal(goal: string): AgentDataOutputKind {
  const normalized = goal.normalize('NFKC');
  if (ROWS_INTENT_PATTERN.test(normalized)) return 'rows';
  if (FINDINGS_INTENT_PATTERN.test(normalized)) return 'findings';
  return 'text';
}

export type AttachmentPlanAugmentation =
  | { ok: true; steps: AgentStepInputLike[]; plannedSteps: AgentToolStepV3[] }
  | {
      ok: false;
      code: 'AGENT_ATTACHMENT_TOO_LARGE';
      chunkCount: number;
      /** The bound of the constraint that refused the plan (see
       * `limitKind`): the chunk ceiling for an oversize set, the
       * derived step ceiling for a plan that cannot fit. */
      limit: number;
      limitKind: 'chunks' | 'steps';
      /** Total steps the augmented plan would need (step refusals only). */
      stepCount?: number;
    };

export function augmentPlanWithAttachments(input: {
  goal: string;
  plannedSteps: readonly AgentToolStepV3[];
  steps: readonly AgentStepInputLike[];
  setId: string;
  setDigest: string;
  view: AgentAttachmentDataView;
}): AttachmentPlanAugmentation {
  const { goal, view } = input;
  const totalChunks = view.totalChunks;
  if (totalChunks > AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN) {
    return { ok: false, code: 'AGENT_ATTACHMENT_TOO_LARGE', chunkCount: totalChunks, limit: AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN, limitKind: 'chunks' };
  }
  const analyzerCount = Math.max(1, Math.ceil(totalChunks / AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP));

  // Copy the base plan under the path confinement of header point 4:
  // file_reader steps pointing anywhere but a set file are dropped,
  // and a file_writer path that is neither a set file nor an
  // artifacts/ path is normalized to the default result artifact.
  // The two arrays stay index-aligned throughout.
  const attachedFileNames = new Set(view.files.map((file) => file.name));
  const steps: AgentStepInputLike[] = [];
  const plannedSteps: AgentToolStepV3[] = [];
  input.steps.forEach((step, index) => {
    if (step.toolName === 'file_reader') {
      const path = step.params.path;
      if (typeof path !== 'string' || !attachedFileNames.has(path)) return;
    }
    let params: ToolParams = { ...step.params };
    if (step.toolName === 'file_writer') {
      const path = step.params.path;
      if (typeof path === 'string' && path.trim() && !attachedFileNames.has(path) && !path.startsWith('artifacts/')) {
        params = { ...params, path: 'artifacts/attachment-result.md' };
      }
    }
    steps.push({ toolName: step.toolName, params });
    plannedSteps.push({ ...input.plannedSteps[index] });
  });

  const stepCount = steps.length + 1 + analyzerCount;
  if (stepCount > AGENT_ATTACHMENT_MAX_PLAN_STEPS) {
    return { ok: false, code: 'AGENT_ATTACHMENT_TOO_LARGE', chunkCount: totalChunks, limit: AGENT_ATTACHMENT_MAX_PLAN_STEPS, limitKind: 'steps', stepCount };
  }

  const outputKind = attachmentOutputKindForGoal(goal);
  const instruction = goal.normalize('NFKC').trim().slice(0, AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS);
  const binding = { attachmentSetId: input.setId, setDigest: input.setDigest };

  const readerStep: AgentStepInputLike = { toolName: 'attachment_reader', params: { ...binding } };
  const analyzerSteps: AgentStepInputLike[] = [];
  const analyzerPlanned: AgentToolStepV3[] = [];
  for (let i = 0; i < analyzerCount; i += 1) {
    const chunkOffset = i * AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP;
    const chunkCount = Math.min(AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP, totalChunks - chunkOffset);
    analyzerSteps.push({
      toolName: 'attachment_analyzer',
      params: {
        ...binding,
        instruction,
        outputKind,
        chunkOffset,
        chunkCount,
        // Chained analyzers merge into one bundle: each continuation
        // names its predecessor (its index in the final step list,
        // computed below once the insertion point is known).
        ...(i > 0 ? { contentFromStep: -1 } : {}),
      },
    });
    analyzerPlanned.push({ toolName: 'attachment_analyzer', reasonCode: 'attachment-analysis' });
  }

  const generativeIndex = steps.findIndex((step) => GENERATIVE_TOOLS.has(step.toolName));
  const insertAt = generativeIndex >= 0 ? generativeIndex : steps.length;

  // Reground the first generative step on the last analyzer step
  // (index = 1 reader + insertAt existing steps + analyzerCount - 1).
  const lastAnalyzerIndex = 1 + insertAt + analyzerCount - 1;
  if (generativeIndex >= 0) {
    const target = steps[generativeIndex];
    if (target.toolName === 'document_generator') {
      const { contentFromPreviousArtifact: _marker, ...rest } = target.params;
      target.params = { ...rest, contentFromStep: lastAnalyzerIndex, dataGrounded: true };
    } else if (target.toolName === 'file_writer') {
      // Attachment mode (design §3.5.3): the fabricated sample content
      // is dropped wholesale; only the path survives, and the content
      // must resolve from the analyzer or the step fails.
      const path = typeof target.params.path === 'string' && target.params.path.trim()
        ? target.params.path
        : 'artifacts/attachment-result.md';
      target.params = { path, contentFromStep: lastAnalyzerIndex };
    }
  }
  // Fix the analyzer chain indices now that the insertion point (and
  // therefore every step's final index) is known: analyzer i sits at
  // 1 + insertAt + i, so its predecessor is one less.
  for (let i = 1; i < analyzerSteps.length; i += 1) {
    analyzerSteps[i].params = { ...analyzerSteps[i].params, contentFromStep: 1 + insertAt + i - 1 };
  }

  const augmentedSteps = [
    readerStep,
    ...steps.slice(0, insertAt),
    ...analyzerSteps,
    ...steps.slice(insertAt),
  ];
  const augmentedPlanned = [
    { toolName: 'attachment_reader', reasonCode: 'attachment-input' } as AgentToolStepV3,
    ...plannedSteps.slice(0, insertAt),
    ...analyzerPlanned,
    ...plannedSteps.slice(insertAt),
  ];
  return { ok: true, steps: augmentedSteps, plannedSteps: augmentedPlanned };
}
