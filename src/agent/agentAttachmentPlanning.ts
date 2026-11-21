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
 *    analyzer step. file_writer steps never reach this point (they
 *    are removed outright, point 4), so the goal-derived sample CSV /
 *    draft markdown the param generator fabricates can never become
 *    a written file.
 * 4. Goal-derived file paths are confined. The base planner and its
 *    param generator treat backtick-quoted or path-like goal tokens
 *    as file paths — a Kubernetes Deployment named `payment-api`
 *    became a file_reader path in production and blocked the run at
 *    execution. In an attachment-bound plan the only files that exist
 *    are the set's, so a file_reader step survives only when its path
 *    names a set file (the attachment_reader already covers the set's
 *    contents, so dropping loses nothing). file_writer steps are
 *    removed outright: the writer's only target is the server's own
 *    repository, which is neither the attachment delivery path (the
 *    run's final artifact is the generative step's output or the
 *    analyzer bundle, design J1(a)) nor writable in production — the
 *    deployed bundle is read-only, and a surviving writer step threw
 *    there and failed the run (2026-11-21, ALE attempt 3). Dropping
 *    loses nothing: the deliverable still comes from the analyzer or
 *    the document step.
 * 5. Research-heuristic steps are confined the same way. The base
 *    planner adds a `web_search_grounding` step whenever the goal
 *    text merely contains a word its heuristic reacts to (search /
 *    latest / current / 最新 …) — in a closed-document audit goal the
 *    word "search" inside a staged-materials note ("page-labeled
 *    text extracted from the PDFs for easier search") was enough,
 *    and the step's query was the entire goal text (production,
 *    2026-11-21, ALE day-1 re-run after the path confinement above).
 *    An attachment-bound plan answers from the bound set, so the
 *    step survives only when the goal itself explicitly asks for
 *    external research (an imperative search / investigation form —
 *    see EXPLICIT_EXTERNAL_RESEARCH_PATTERN). The judgment is
 *    deliberately conservative: incidental mentions never keep the
 *    step, because the set cannot satisfy it and the task did not
 *    ask the open web anything.
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
 * 6. Output-file specification. A goal that names its deliverable
 * (`output/root_cause_analysis.json`, `output/audit_report.md`) has
 * that specification carried into the plan: the document step gets
 * the required file name (and, for JSON, the required top-level
 * keys), and the analyzers get the key list so their structured
 * sections can fill it. Until 2026-11-21 nothing read the
 * specification at all — the document step always produced a
 * markdown file under a title-derived name, so a JSON deliverable
 * scored 0 (ALE wave 1, K8s). See
 * AGENT_ARTIFACT_FORMAT_DESIGN_2026-11-21.md.
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

/**
 * Intent vocabulary for the output-kind decision. Two production
 * failure modes (ALE day-1, 2026-11-21) shape these patterns:
 *
 * - The English rows markers must be action forms. The old `\bclassif`
 *   / `\bextract` also matched schema and material descriptions — the
 *   K8s RCA goal's "short classification label" and the M&A audit
 *   goal's "extracted_text" / "extracted from the PDFs" — and turned
 *   prose-only audit/RCA goals into `rows`, where the degenerated
 *   file-name key yardstick then failed coverage deterministically.
 *   The bare verb forms (`classify `, `extract `, `classifying each`
 *   …) name the requested operation; the derived forms
 *   (`classification`, `classified`, `extracted`, `extraction`)
 *   describe things and no longer count.
 * - Strong findings markers (監査 / 照合 / 原因 / audit / root cause)
 *   outrank rows vocabulary: an audit goal that also mentions
 *   classifying or extracting its materials is an audit, not a rows
 *   task.
 */
const STRONG_FINDINGS_INTENT_PATTERN = /監査|照合|原因|\baudit|root[\s_-]*cause/i;
const ROWS_INTENT_PATTERN = /分類|抽出|集計|一覧化|\bclassify\s|\bclassifying\s+(?:each|every|all|the)\b|\bextract\s|\btabulat/i;
const FINDINGS_INTENT_PATTERN = /分析|不整合|チェック|\bconsisten|\banaly[sz]|\binvestigat/i;

/** The plan-time output-kind decision (design §3.6.4): a deterministic
 * reading of the goal text — classification/extraction goals produce
 * rows, audit/analysis goals produce findings, everything else text.
 * Strong audit/RCA markers win over rows vocabulary (see above). */
export function attachmentOutputKindForGoal(goal: string): AgentDataOutputKind {
  const normalized = goal.normalize('NFKC');
  if (STRONG_FINDINGS_INTENT_PATTERN.test(normalized)) return 'findings';
  if (ROWS_INTENT_PATTERN.test(normalized)) return 'rows';
  if (FINDINGS_INTENT_PATTERN.test(normalized)) return 'findings';
  return 'text';
}

export type AttachmentOutputFileSpec = {
  /** Required deliverable file name (basename only — a goal's path
   * specification is read as a file-name specification). */
  filename: string;
  format: 'json' | 'markdown';
  /** Required top-level keys, in the goal's order (JSON specs only;
   * empty when the goal names a file but lists no keys). */
  topLevelKeys: string[];
};

const OUTPUT_FILE_SPEC_PATTERN = /output\/([A-Za-z0-9][A-Za-z0-9._-]*\.(json|md|markdown))\b/;
const TOP_LEVEL_KEY_PATTERN = /`([A-Za-z_][A-Za-z0-9_]*)`/g;
const MAX_TOP_LEVEL_KEYS = 12;
const MAX_OUTPUT_FILENAME_CHARS = 120;

/**
 * Reads a goal's deliverable-file specification, if it names one:
 * `output/<name>.json` or `output/<name>.md` (backtick-quoted or in a
 * fenced block — either form counts), plus the required top-level
 * keys listed after a "top-level keys" phrase for JSON specs. Only
 * `json` and `md`/`markdown` are supported: other extensions (txt,
 * csv, …) belong to the later F5 artifact work and yield null, so a
 * goal naming one keeps the previous behavior instead of a half
 * supported format. Returns null when the goal names no output file.
 */
export function extractAttachmentOutputFileSpec(goal: string): AttachmentOutputFileSpec | null {
  const normalized = goal.normalize('NFKC');
  const fileMatch = OUTPUT_FILE_SPEC_PATTERN.exec(normalized);
  if (!fileMatch) return null;
  const filename = fileMatch[1];
  if (filename.length > MAX_OUTPUT_FILENAME_CHARS) return null;
  const format: AttachmentOutputFileSpec['format'] = fileMatch[2] === 'json' ? 'json' : 'markdown';
  const topLevelKeys: string[] = [];
  if (format === 'json') {
    const keysAt = normalized.search(/top-level keys/i);
    if (keysAt >= 0) {
      // The keys usually sit in the fenced block right after the
      // phrase, as a plain comma-separated list (the K8s shape) — read
      // that block only, so the schema-details section below it (which
      // backticks the same key names plus field names like
      // safe_to_rollback) cannot leak extra keys in. Without a fence,
      // fall back to the backtick-quoted identifiers on the first line.
      const window = normalized.slice(keysAt, keysAt + 600);
      const fenced = window.match(/```[A-Za-z0-9_.+-]*\s*\n([\s\S]*?)```/);
      const scope = fenced ? fenced[1] : window.split('\n')[0] ?? '';
      const candidates = fenced
        ? scope.split(/[\s,;]+/)
        : [...scope.matchAll(TOP_LEVEL_KEY_PATTERN)].map((match) => match[1]);
      for (const candidate of candidates) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) continue;
        if (!topLevelKeys.includes(candidate)) topLevelKeys.push(candidate);
        if (topLevelKeys.length >= MAX_TOP_LEVEL_KEYS) break;
      }
    }
  }
  return { filename, format, topLevelKeys };
}

/**
 * Whether the goal itself explicitly asks for external research, as
 * opposed to merely containing a word the planner's research
 * heuristic reacts to. Conservative by design (header point 5): an
 * imperative search / investigation form, in Japanese or English.
 * Incidental mentions — "for easier search" in a staged-materials
 * note, the word 最新 describing data already inside the set — do
 * not count.
 */
const EXPLICIT_EXTERNAL_RESEARCH_PATTERN =
  /調べて|調査して|検索して|調べる|調査する|検索する|ウェブ検索|インターネット検索|\bsearch\s+(?:the\s+web|online|for)\b|\bweb\s+search\b|\blook\s*up\b|\bresearch\s+(?:the\s+)?(?:latest|current)\b|\bfind\s+the\s+latest\b/i;

export function goalExplicitlyRequestsExternalResearch(goal: string): boolean {
  return EXPLICIT_EXTERNAL_RESEARCH_PATTERN.test(goal.normalize('NFKC'));
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

  // Copy the base plan under the confinements of header points 4
  // and 5: file_reader steps pointing anywhere but a set file are
  // dropped, file_writer steps are dropped outright (their only
  // target is the server's own repository — see point 4), and a
  // web_search_grounding step survives only when the goal explicitly
  // asks for external research. The two arrays stay index-aligned
  // throughout.
  const attachedFileNames = new Set(view.files.map((file) => file.name));
  const explicitResearch = goalExplicitlyRequestsExternalResearch(goal);
  const steps: AgentStepInputLike[] = [];
  const plannedSteps: AgentToolStepV3[] = [];
  input.steps.forEach((step, index) => {
    if (step.toolName === 'file_reader') {
      const path = step.params.path;
      if (typeof path !== 'string' || !attachedFileNames.has(path)) return;
    }
    if (step.toolName === 'web_search_grounding' && !explicitResearch) return;
    if (step.toolName === 'file_writer') return;
    steps.push({ toolName: step.toolName, params: { ...step.params } });
    plannedSteps.push({ ...input.plannedSteps[index] });
  });

  const stepCount = steps.length + 1 + analyzerCount;
  if (stepCount > AGENT_ATTACHMENT_MAX_PLAN_STEPS) {
    return { ok: false, code: 'AGENT_ATTACHMENT_TOO_LARGE', chunkCount: totalChunks, limit: AGENT_ATTACHMENT_MAX_PLAN_STEPS, limitKind: 'steps', stepCount };
  }

  const outputKind = attachmentOutputKindForGoal(goal);
  const outputSpec = extractAttachmentOutputFileSpec(goal);
  const structuredJsonKeys = outputSpec?.format === 'json' && outputSpec.topLevelKeys.length > 0
    ? outputSpec.topLevelKeys
    : undefined;
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
        // A JSON deliverable needs structured sections (resources,
        // remediations, typed findings) from the analyzers; the key
        // list tells them which report the findings feed.
        ...(structuredJsonKeys ? { structuredJsonKeys } : {}),
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
      target.params = {
        ...rest,
        contentFromStep: lastAnalyzerIndex,
        dataGrounded: true,
        // Carry the goal's output-file specification (header point
        // 6): the required file name, and for JSON the required
        // format and top-level keys, so the document step assembles
        // the specified file instead of a title-derived markdown.
        ...(outputSpec ? { outputFilename: outputSpec.filename } : {}),
        ...(outputSpec?.format === 'json'
          ? { format: 'json', jsonTopLevelKeys: outputSpec.topLevelKeys }
          : {}),
      };
    }
    // No file_writer branch: writer steps never survive the copy
    // loop above, so document_generator is the only generative step
    // an attachment-bound plan can carry here.
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
