import type { AgentToolStepV3 } from './agentToolPlannerV3.js';
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
 *
 * Every data step carries `{ attachmentSetId, setDigest }`, so the
 * canonical params digest binds the set's exact contents into the
 * approval, exactly as F1 established. The key column is never a plan
 * param (design §3.6.4): what the human approves is which data and
 * what operation, not a guessed column name.
 *
 * Oversize is refused here, at plan time, with the counts attached
 * (design §4.3): a set needing more than 48 chunks, or a plan that
 * cannot fit the step ceiling, never starts executing.
 */

export type AgentStepInputLike = { toolName: AgentToolStepV3['toolName']; params: ToolParams };

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
  | { ok: false; code: 'AGENT_ATTACHMENT_TOO_LARGE'; chunkCount: number; limit: number };

export function augmentPlanWithAttachments(input: {
  goal: string;
  plannedSteps: readonly AgentToolStepV3[];
  steps: readonly AgentStepInputLike[];
  setId: string;
  setDigest: string;
  view: AgentAttachmentDataView;
  maxSteps: number;
}): AttachmentPlanAugmentation {
  const { goal, view } = input;
  const totalChunks = view.totalChunks;
  if (totalChunks > AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN) {
    return { ok: false, code: 'AGENT_ATTACHMENT_TOO_LARGE', chunkCount: totalChunks, limit: AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN };
  }
  const analyzerCount = Math.max(1, Math.ceil(totalChunks / AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP));
  if (input.steps.length + 1 + analyzerCount > input.maxSteps) {
    return { ok: false, code: 'AGENT_ATTACHMENT_TOO_LARGE', chunkCount: totalChunks, limit: AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN };
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

  const steps: AgentStepInputLike[] = input.steps.map((step) => ({ toolName: step.toolName, params: { ...step.params } }));
  const plannedSteps: AgentToolStepV3[] = input.plannedSteps.map((step) => ({ ...step }));
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
