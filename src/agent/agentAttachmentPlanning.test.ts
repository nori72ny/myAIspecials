// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AGENT_ATTACHMENT_MAX_PLAN_STEPS,
  attachmentOutputKindForGoal,
  augmentPlanWithAttachments,
  extractAttachmentOutputFileSpec,
  goalExplicitlyRequestsExternalResearch,
  goalRequestsInconsistencyAudit,
  type AgentStepInputLike,
} from './agentAttachmentPlanning.js';
import type { AgentAttachmentDataView } from './agentAttachmentData.js';
import type { AgentToolStepV3 } from './agentToolPlannerV3.js';

/**
 * Regression coverage for the two planning-layer defects that blocked
 * the ALE day-1 tasks in production (2026-11-21, release 13132ebf):
 *
 * 1. Step-cap incoherence — the flat 6-step ceiling refused mid-size
 *    sets at plan time (M&A: 17 chunks → reader + 3 analyzers + base
 *    steps > 6) and the refusal reported the 48-chunk constant even
 *    though the step ceiling was the binding constraint.
 * 2. Planner contamination — the deterministic planner turned the
 *    backtick-quoted Kubernetes Deployment name `payment-api` in the
 *    goal text into a file_reader path (and a file_writer target);
 *    the reader step then blocked the run at execution.
 * 3. Research-heuristic contamination — a web_search_grounding step
 *    the planner inserted on an incidental keyword ("search" in a
 *    staged-materials note) survived into a closed-document audit
 *    plan (defect 3 block below).
 *
 * The file_writer removal (ALE attempt 3, 2026-11-21) is covered in
 * the defect 2 block: writer steps no longer survive augmentation at
 * all, because their only target — the server's own repository — is
 * read-only in production and is not the delivery path (design
 * J1(a)).
 */

function viewWith(totalChunks: number, fileNames: string[]): AgentAttachmentDataView {
  return {
    files: fileNames.map((name) => ({ name, kind: 'prose' as const, charCount: 1_000 })),
    chunks: [],
    totalChunks,
    keyField: 'name',
    expectedKeys: [],
    numericColumns: [],
    aggregates: {},
  };
}

type BaseEntry = { toolName: AgentStepInputLike['toolName']; params?: Record<string, unknown>; reasonCode: string };

function basePlan(entries: BaseEntry[]): { steps: AgentStepInputLike[]; plannedSteps: AgentToolStepV3[] } {
  return {
    steps: entries.map((entry) => ({ toolName: entry.toolName, params: entry.params ?? {} })),
    plannedSteps: entries.map((entry) => ({ toolName: entry.toolName, reasonCode: entry.reasonCode })),
  };
}

const MA_FILES = ['announcement.txt', 'buyer1_report.txt', 'buyer2_report.txt', 'seller_report.txt', 'document_manifest.json'];
const K8S_FILES = ['cluster_state.txt', 'deployment.yaml', 'failing_pod.log'];

describe('attachment plan step ceiling (defect 1)', () => {
  it('derives the ceiling from the parts it must hold: 6 base + reader + 12 analyzers = 19', () => {
    expect(AGENT_ATTACHMENT_MAX_PLAN_STEPS).toBe(19);
  });

  it('forms a valid plan for the M&A shape (17 chunks, 3 base steps)', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: '監査レポート', format: 'markdown', brief: '監査' }, reasonCode: 'document-request' },
      { toolName: 'file_writer', params: { path: 'artifacts/document.md', contentFromPreviousArtifact: true }, reasonCode: 'write-specific-file' },
      { toolName: 'verification_runner', params: {}, reasonCode: 'verification-command' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付文書を照合して不整合を監査し、レポートを作成してください',
      ...base,
      setId: 'att-ma',
      setDigest: 'digest-ma',
      view: viewWith(17, MA_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 surviving base steps (the file_writer is dropped) + 1 reader
    // + ceil(17/4)=5 analyzers = 8.
    expect(result.steps).toHaveLength(8);
    expect(result.plannedSteps.map((step) => step.toolName)).toEqual(result.steps.map((step) => step.toolName));
    const analyzers = result.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.map((step) => step.params.chunkCount)).toEqual([4, 4, 4, 4, 1]);
    expect(analyzers[1].params.contentFromStep).toBe(1);
    expect(analyzers[2].params.contentFromStep).toBe(2);
    expect(analyzers[3].params.contentFromStep).toBe(3);
    expect(analyzers[4].params.contentFromStep).toBe(4);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.dataGrounded).toBe(true);
    expect(document?.params.contentFromStep).toBe(5);
  });

  it('forms a valid plan for the AGORA shape (35 chunks)', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: '分類結果', format: 'markdown', brief: '分類' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付文書を分類して一覧化してください',
      ...base,
      setId: 'att-agora',
      setDigest: 'digest-agora',
      view: viewWith(35, ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt']),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analyzers = result.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.map((step) => step.params.chunkCount)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 3]);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.contentFromStep).toBe(9);
  });

  it('admits the largest admissible shape: 48 chunks on a full 6-step base plan (19 steps)', () => {
    const base = basePlan([
      { toolName: 'repository_explorer', params: {}, reasonCode: 'repository-overview' },
      { toolName: 'web_search_grounding', params: { query: '最新動向' }, reasonCode: 'current-research' },
      { toolName: 'code_interpreter', params: { mode: 'generate', instruction: '集計コード' }, reasonCode: 'code-analysis' },
      { toolName: 'document_generator', params: { title: '報告書', format: 'markdown', brief: '報告' }, reasonCode: 'document-request' },
      { toolName: 'image_prompt_compiler', params: { prompt: '図表' }, reasonCode: 'visual-request' },
      { toolName: 'verification_runner', params: {}, reasonCode: 'verification-command' },
    ]);
    const result = augmentPlanWithAttachments({
      // The research step in the base plan survives augmentation
      // because this goal explicitly asks for research (調査して);
      // without the explicit request the step would be confined out
      // and the plan would come to 18 steps (see defect 3 below).
      // (The sixth base slot is not a file_writer: writer steps are
      // dropped from attachment-bound plans, so one could never
      // contribute to the largest admissible shape.)
      goal: '添付データを分析し、最新の動向も調査して報告書を作成してください',
      ...base,
      setId: 'att-max',
      setDigest: 'digest-max',
      view: viewWith(48, MA_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(AGENT_ATTACHMENT_MAX_PLAN_STEPS);
  });

  it('refuses a plan that cannot fit the derived ceiling and names the step limit', () => {
    // One step beyond anything the planner can emit: the guard is
    // defensive, and its refusal must report the step bound — not the
    // chunk constant the old code reported for this branch.
    const base = basePlan([
      { toolName: 'repository_explorer', params: {}, reasonCode: 'repository-overview' },
      { toolName: 'web_search_grounding', params: { query: 'q' }, reasonCode: 'current-research' },
      { toolName: 'code_interpreter', params: { mode: 'generate', instruction: 'x' }, reasonCode: 'code-analysis' },
      { toolName: 'document_generator', params: { title: 't', format: 'markdown', brief: 'b' }, reasonCode: 'document-request' },
      { toolName: 'image_prompt_compiler', params: { prompt: 'p' }, reasonCode: 'visual-request' },
      { toolName: 'file_writer', params: { path: 'artifacts/document.md', contentFromPreviousArtifact: true }, reasonCode: 'write-specific-file' },
      { toolName: 'code_interpreter', params: { mode: 'generate', instruction: 'y' }, reasonCode: 'code-analysis' },
      { toolName: 'verification_runner', params: {}, reasonCode: 'verification-command' },
    ]);
    const result = augmentPlanWithAttachments({
      // Same explicit-research goal as the admission test above: the
      // research step is kept and only the file_writer entry is
      // dropped, so the would-be plan is 20 steps.
      goal: '添付データを分析し、最新の動向も調査して報告書を作成してください',
      ...base,
      setId: 'att-over',
      setDigest: 'digest-over',
      view: viewWith(48, MA_FILES),
    });
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.code).toBe('AGENT_ATTACHMENT_TOO_LARGE');
    expect(result.limitKind).toBe('steps');
    expect(result.limit).toBe(AGENT_ATTACHMENT_MAX_PLAN_STEPS);
    expect(result.stepCount).toBe(20);
    expect(result.chunkCount).toBe(48);
  });

  it('refuses an oversize set and names the chunk limit', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: 't', format: 'markdown', brief: 'b' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付データを分析してください',
      ...base,
      setId: 'att-huge',
      setDigest: 'digest-huge',
      view: viewWith(49, MA_FILES),
    });
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.limitKind).toBe('chunks');
    expect(result.limit).toBe(48);
    expect(result.chunkCount).toBe(49);
    expect(result.stepCount).toBeUndefined();
  });
});

describe('attachment plan path confinement (defect 2)', () => {
  it('drops the goal-token file_reader and the file_writer step (K8s shape)', () => {
    // The production plan for the K8s RCA goal: the planner emitted a
    // file_reader and a file_writer whose paths were the backtick-
    // quoted Deployment name `payment-api` from the goal text.
    const base = basePlan([
      { toolName: 'file_reader', params: { path: 'payment-api' }, reasonCode: 'read-specific-file' },
      { toolName: 'document_generator', params: { title: '原因分析', format: 'markdown', brief: '分析' }, reasonCode: 'document-request' },
      { toolName: 'file_writer', params: { path: 'payment-api', contentFromPreviousArtifact: true }, reasonCode: 'write-specific-file' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: 'Deployment `payment-api` の障害の原因を分析してレポートを作成してください',
      ...base,
      setId: 'att-k8s',
      setDigest: 'digest-k8s',
      view: viewWith(4, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'attachment_analyzer',
      'document_generator',
    ]);
    expect(result.plannedSteps.map((step) => step.toolName)).toEqual(result.steps.map((step) => step.toolName));
    for (const step of result.steps) {
      expect(step.params.path).not.toBe('payment-api');
    }
    // The writer step is gone entirely (attempt 3): its only target
    // was the server's own repository, read-only in production. The
    // grounded document is the plan's final step and the deliverable.
    expect(result.steps.some((step) => step.toolName === 'file_writer')).toBe(false);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.dataGrounded).toBe(true);
    expect(document?.params.contentFromStep).toBe(1);
    const analyzer = result.steps.find((step) => step.toolName === 'attachment_analyzer');
    expect(analyzer?.params.outputKind).toBe('findings');
  });

  it('keeps a file_reader step that names a file in the bound set', () => {
    const base = basePlan([
      { toolName: 'file_reader', params: { path: 'deployment.yaml' }, reasonCode: 'read-named-file' },
      { toolName: 'document_generator', params: { title: '分析', format: 'markdown', brief: '分析' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: 'deployment.yamlの内容を確認して原因を分析してください',
      ...base,
      setId: 'att-k8s2',
      setDigest: 'digest-k8s2',
      view: viewWith(4, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'file_reader',
      'attachment_analyzer',
      'document_generator',
    ]);
    expect(result.steps[1].params.path).toBe('deployment.yaml');
  });

  it('drops a file_writer step even when its path is an artifacts/ path', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: '報告', format: 'markdown', brief: '報告' }, reasonCode: 'document-request' },
      { toolName: 'file_writer', params: { path: 'artifacts/report.md', contentFromPreviousArtifact: true }, reasonCode: 'write-specific-file' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付データを分析してレポートを作成してください',
      ...base,
      setId: 'att-art',
      setDigest: 'digest-art',
      view: viewWith(2, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'attachment_analyzer',
      'document_generator',
    ]);
    expect(result.steps.some((step) => step.toolName === 'file_writer')).toBe(false);
  });

  it('closes the plan at the analyzer when file_writer was the only generative step', () => {
    // A writer-only generative shape: once the writer is dropped no
    // generative step remains, so the analyzers close the plan and
    // their bundle is the run's final artifact (design J1(a)) — the
    // goal-derived fabricated content is never written anywhere.
    const base = basePlan([
      { toolName: 'file_reader', params: { path: 'deployment.yaml' }, reasonCode: 'read-named-file' },
      { toolName: 'file_writer', params: { path: 'output/root_cause_analysis.json', content: 'fabricated draft' }, reasonCode: 'write-specific-file' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付データを分析してファイルに書いてください',
      ...base,
      setId: 'att-k8s3',
      setDigest: 'digest-k8s3',
      view: viewWith(4, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'file_reader',
      'attachment_analyzer',
    ]);
    const last = result.steps[result.steps.length - 1];
    expect(last.toolName).toBe('attachment_analyzer');
    expect(last.params.chunkCount).toBe(4);
  });
});

/**
 * The staged ALE day-1 goal texts, verbatim (the Japanese preamble is
 * the activation pack's staging wrapper; the bodies are the tasks as
 * submitted). Both are prose-only audit/RCA goals that the pre-fix
 * classifier deterministically read as `rows`: the K8s goal through
 * "short classification label", the M&A goal through "extracted_text"
 * / "extracted from the PDFs" — and both then failed or would fail
 * the file-name key coverage gate in production.
 */
const K8S_STAGED_GOAL = "添付ファイルが input です。成果物は指定されたファイル名・形式のファイルとして作成してください。パスの指定はファイル名の指定として読み替えてください。\n\n# Kubernetes Payment API Root-Cause Analysis\n\nYou are the on-call SRE for Northwind Payments. The `payment-api` Deployment in\nthe `prod` namespace started flapping after a routine chart-value change. The\nHPA reports memory utilization above target and dashboards show elevated 5xx errors.\n\n## Visible Inputs\n\nAll evidence files are in `input/`:\n\n- `cluster_state.txt`: captured kubectl pod, deployment, event, top, and HPA output.\n- `deployment.yaml`: currently applied Deployment and HPA YAML.\n- `failing_pod.log`: stdout from a crashing payment-api pod across two restart cycles.\n\n## Required Output\n\nWrite exactly one JSON file:\n\n```text\noutput/root_cause_analysis.json\n```\n\nThe JSON report must include these top-level keys:\n\n```text\nincident_metadata, root_causes, affected_resources, remediation_plan, summary\n```\n\n### Schema details\n\n**`incident_metadata`** — object with at least:\n- `safe_to_rollback` (boolean): whether rolling back to the previous ReplicaSet revision is safe.\n\n**`root_causes`** — array of objects, each with at least:\n- `type` (string): short classification label, e.g. `\"OOMKilled\"`, `\"liveness_probe_too_aggressive\"`, `\"missing_metrics_port_env\"`.\n- `severity` (string): one of `\"critical\"`, `\"high\"`, `\"medium\"`, `\"low\"`.\n- `description` (string): explanation of the root cause.\n- `evidence` (array of strings): each item must be a verbatim text string copied from one of the visible input files (not a file-name citation — the actual text that appears in the file).\n\n**`affected_resources`** — array of objects, each with `kind`, `name`, and `namespace`.\n\n**`remediation_plan`** — array of objects, each with at least an `action` (string).\n\n**`summary`** — string summarizing the incident and recommended path forward.\n\n### Guidelines\n\nIdentify root causes, list affected Kubernetes resources, propose prioritized\nremediation actions, and state whether rollback to the previous ReplicaSet is\nsafe. Do not invent metric values, commit SHAs, or resource names.\n";
const MA_STAGED_GOAL = "添付ファイルが input です。成果物は指定されたファイル名・形式のファイルとして作成してください。パスの指定はファイル名の指定として読み替えてください。\n\n# Task Brief\n\nReview four Chinese regulatory filings about the same share-transfer transaction and write an English inconsistency audit.\n\nDeliver exactly one file:\n\n- `output/audit_report.md`\n\nReport requirements:\n\n1. Write in English.\n2. Identify every material inconsistency you can support from the documents.\n3. For each finding, include:\n   - a short English title;\n   - a brief explanation of the conflict;\n   - the original Chinese text that proves the issue;\n   - a location marker with document name and page number.\n4. Do not invent issues that the documents do not support.\n\nAvailable staged materials:\n\n- `input/source_documents/` contains the original PDFs.\n- `input/extracted_text/` contains page-labeled UTF-8 text extracted from the PDFs for easier search.\n- `input/document_manifest.json` maps the canonical filenames to the original Chinese filenames.\n- `software/python` launches the baseline VM Python interpreter if scripting is helpful.\n\nSuggested output structure:\n\n```markdown\n# Share Transfer Disclosure Consistency Review\n\n## Finding 1: <title>\n- Documents: ...\n- Why it is inconsistent: ...\n- Evidence:\n  - `Document X, Page Y`: `<Chinese text>`\n  - `Document Z, Page W`: `<Chinese text>`\n```\n";

describe('attachment output kind classification (prose audit/RCA misread as rows)', () => {
  it('classifies the staged K8s RCA goal as findings, not rows', () => {
    // The goal's only rows-flavored token is the schema description
    // "short classification label"; its operative markers are
    // "Root-Cause" / "root causes".
    expect(attachmentOutputKindForGoal(K8S_STAGED_GOAL)).toBe('findings');
  });

  it('classifies the staged M&A consistency-audit goal as findings, not rows', () => {
    // The goal's only rows-flavored tokens describe the materials
    // ("extracted_text", "extracted from the PDFs"); the task is an
    // "inconsistency audit".
    expect(attachmentOutputKindForGoal(MA_STAGED_GOAL)).toBe('findings');
  });

  it('plans findings analyzers for both staged shapes', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: 'レポート', format: 'markdown', brief: '報告' }, reasonCode: 'document-request' },
    ]);
    const k8s = augmentPlanWithAttachments({
      goal: K8S_STAGED_GOAL, ...base, setId: 'att-k8s-staged', setDigest: 'digest-k8s-staged', view: viewWith(4, K8S_FILES),
    });
    expect(k8s.ok).toBe(true);
    if (k8s.ok) {
      expect(k8s.steps.find((step) => step.toolName === 'attachment_analyzer')?.params.outputKind).toBe('findings');
    }
    const ma = augmentPlanWithAttachments({
      goal: MA_STAGED_GOAL, ...base, setId: 'att-ma-staged', setDigest: 'digest-ma-staged', view: viewWith(17, MA_FILES),
    });
    expect(ma.ok).toBe(true);
    if (ma.ok) {
      const analyzers = ma.steps.filter((step) => step.toolName === 'attachment_analyzer');
      expect(analyzers.length).toBeGreaterThan(1);
      for (const analyzer of analyzers) expect(analyzer.params.outputKind).toBe('findings');
    }
  });

  it('does not treat derived or descriptive forms as a rows request', () => {
    expect(attachmentOutputKindForGoal('Summarize the text extracted from the PDFs.')).toBe('text');
    expect(attachmentOutputKindForGoal('Explain the classification scheme used in the attached documents.')).toBe('text');
  });

  it('keeps genuine classification goals at rows (AGORA and Basel shapes)', () => {
    // Operative excerpts of the staged goals, preserving every
    // classification-relevant phrase: the noun "Classification" in
    // the titles and Basel's `classified_events.csv` output name are
    // descriptive; the imperative "Classify …" is the task.
    const agora = [
      '# AGORA Governance Classification Task',
      'You are acting as a policy analyst. Classify three AI governance documents across the taxonomy dimensions defined in the submitted materials.',
    ].join('\n');
    expect(attachmentOutputKindForGoal(agora)).toBe('rows');
    const basel = [
      '# Basel Operational Risk Classification And BIA Capital',
      'Classify 60 Chinese operational-risk loss events into Basel loss event categories and Basel business lines, then calculate operational-risk regulatory capital under the Basel Basic Indicator Approach (BIA).',
      '- `classified_events.csv`',
    ].join('\n');
    expect(attachmentOutputKindForGoal(basel)).toBe('rows');
    expect(attachmentOutputKindForGoal('添付CSVの各行を金額で分類して一覧化してください')).toBe('rows');
    expect(attachmentOutputKindForGoal('Classify each row of the attached CSV by amount and list the results.')).toBe('rows');
  });

  it('lets strong audit markers outrank classification vocabulary', () => {
    expect(attachmentOutputKindForGoal('監査のため、各文書を分類ラベルで整理し、不整合を洗い出してください')).toBe('findings');
    expect(attachmentOutputKindForGoal('Extract the key figures from each filing and audit them for consistency.')).toBe('findings');
  });
});

/**
 * Regression coverage for the third planning-layer defect, found by
 * the ALE day-1 re-run after the #1416 fixes deployed (production
 * release bc1c1918): the step ceiling and the path confinement both
 * held, but the M&A audit plan still carried a web_search_grounding
 * step (reasonCode current-research, query = the entire goal text)
 * that the deterministic planner had inserted because the goal's
 * staged-materials note contains the word "search" ("page-labeled
 * UTF-8 text extracted from the PDFs for easier search"). The task
 * is a closed-document audit ("Do not invent issues that the
 * documents do not support"); the step is outside its scope, so the
 * driver refused approval and no run was created. (This block was
 * once reverted by a snapshot push; it is restored here, with the
 * writer expectations updated for the attempt-3 writer removal.)
 */
describe('attachment plan research confinement (defect 3)', () => {
  it('drops the heuristic research step from the M&A audit plan (production shape)', () => {
    // The base plan the deterministic planner emitted in production:
    // the research step (its query was the whole goal text) ahead of
    // the document and writer steps.
    const base = basePlan([
      { toolName: 'web_search_grounding', params: { query: MA_STAGED_GOAL }, reasonCode: 'current-research' },
      { toolName: 'document_generator', params: { title: 'Share Transfer Disclosure Consistency Review', format: 'markdown', brief: '監査' }, reasonCode: 'document-request' },
      { toolName: 'file_writer', params: { path: 'output/audit_report.md', contentFromPreviousArtifact: true }, reasonCode: 'write-specific-file' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: MA_STAGED_GOAL,
      ...base,
      setId: 'att-ma3',
      setDigest: 'digest-ma3',
      view: viewWith(17, MA_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'attachment_analyzer',
      'attachment_analyzer',
      'attachment_analyzer',
      'attachment_analyzer',
      'attachment_analyzer',
      'document_generator',
    ]);
    expect(result.plannedSteps.map((step) => step.toolName)).toEqual(result.steps.map((step) => step.toolName));
    expect(result.steps.some((step) => step.toolName === 'web_search_grounding')).toBe(false);
    expect(result.steps.some((step) => step.toolName === 'file_writer')).toBe(false);
    // The rest of the production shape is untouched: analyzers cover
    // all 17 chunks and the document is regrounded on the last one.
    const analyzers = result.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.map((step) => step.params.chunkCount)).toEqual([4, 4, 4, 4, 1]);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.dataGrounded).toBe(true);
    expect(document?.params.contentFromStep).toBe(5);
  });

  it('keeps the research step when the goal explicitly requests research (Japanese)', () => {
    const base = basePlan([
      { toolName: 'web_search_grounding', params: { query: '最新の市場動向' }, reasonCode: 'current-research' },
      { toolName: 'document_generator', params: { title: '分析レポート', format: 'markdown', brief: '分析' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付データを分析し、最新の市場動向も調査してレポートを作成してください',
      ...base,
      setId: 'att-research-ja',
      setDigest: 'digest-research-ja',
      view: viewWith(4, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'web_search_grounding',
      'attachment_analyzer',
      'document_generator',
    ]);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.contentFromStep).toBe(2);
  });

  it('keeps the research step when the goal explicitly requests research (English)', () => {
    const base = basePlan([
      { toolName: 'web_search_grounding', params: { query: 'latest exchange rates' }, reasonCode: 'current-research' },
      { toolName: 'document_generator', params: { title: 'Report', format: 'markdown', brief: 'analyze' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: 'Search the web for the latest exchange rates and analyze the attached data into a report',
      ...base,
      setId: 'att-research-en',
      setDigest: 'digest-research-en',
      view: viewWith(4, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'web_search_grounding',
      'attachment_analyzer',
      'document_generator',
    ]);
  });

  it('drops the research step when 最新 only describes data already in the set', () => {
    const base = basePlan([
      { toolName: 'web_search_grounding', params: { query: '最新の売上データ' }, reasonCode: 'current-research' },
      { toolName: 'document_generator', params: { title: '集計レポート', format: 'markdown', brief: '集計' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '最新の売上データ（添付ファイル）を集計してレポートを作成してください',
      ...base,
      setId: 'att-incidental',
      setDigest: 'digest-incidental',
      view: viewWith(2, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'attachment_analyzer',
      'document_generator',
    ]);
    expect(result.steps.some((step) => step.toolName === 'web_search_grounding')).toBe(false);
  });

  it('reads explicit research requests conservatively (helper)', () => {
    // The M&A staged goal's only research-flavored token is the
    // materials note "for easier search" — not a request.
    expect(goalExplicitlyRequestsExternalResearch(MA_STAGED_GOAL)).toBe(false);
    expect(goalExplicitlyRequestsExternalResearch('添付データを分析し、最新の動向も調査して報告書を作成してください')).toBe(true);
    expect(goalExplicitlyRequestsExternalResearch('Search the web for the latest exchange rates and analyze the attached data into a report')).toBe(true);
    expect(goalExplicitlyRequestsExternalResearch('最新の売上データ（添付ファイル）を集計してレポートを作成してください')).toBe(false);
  });
});

describe('attachment output file specification (artifact format)', () => {
  const JSON_GOAL = '添付ファイルが input です。\n\nWrite exactly one JSON file:\n\n```text\noutput/root_cause_analysis.json\n```\n\nThe JSON report must include these top-level keys:\n\n```text\nincident_metadata, root_causes, affected_resources, remediation_plan, summary\n```';
  const MD_GOAL = '添付ファイルが input です。\n\nDeliver exactly one file:\n\n- `output/audit_report.md`\n\nIdentify every material inconsistency you can support from the documents.';

  it('extracts the JSON file name and required top-level keys (K8s shape)', () => {
    const spec = extractAttachmentOutputFileSpec(JSON_GOAL);
    expect(spec).toEqual({
      filename: 'root_cause_analysis.json',
      format: 'json',
      topLevelKeys: ['incident_metadata', 'root_causes', 'affected_resources', 'remediation_plan', 'summary'],
    });
  });

  it('extracts the markdown file name with no keys (M&A shape)', () => {
    const spec = extractAttachmentOutputFileSpec(MD_GOAL);
    expect(spec).toEqual({ filename: 'audit_report.md', format: 'markdown', topLevelKeys: [] });
  });

  it('returns null when the goal names no output file', () => {
    expect(extractAttachmentOutputFileSpec('添付CSVの各行を分類してレポートを作成してください')).toBeNull();
  });

  it('rejects a traversal path instead of reading a file name out of it', () => {
    expect(extractAttachmentOutputFileSpec('Write the report to output/../secret.json')).toBeNull();
  });

  it('ignores unsupported extensions (txt belongs to the later F5 work)', () => {
    expect(extractAttachmentOutputFileSpec('Write the report to output/notes.txt')).toBeNull();
  });

  it('carries the JSON spec into the analyzer and document steps (K8s shape)', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: '原因分析', format: 'markdown', brief: '分析' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: JSON_GOAL,
      ...base,
      setId: 'att-k8s-json',
      setDigest: 'digest-k8s-json',
      view: viewWith(4, K8S_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analyzer = result.steps.find((step) => step.toolName === 'attachment_analyzer');
    expect(analyzer?.params.structuredJsonKeys).toEqual([
      'incident_metadata', 'root_causes', 'affected_resources', 'remediation_plan', 'summary',
    ]);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.format).toBe('json');
    expect(document?.params.outputFilename).toBe('root_cause_analysis.json');
    expect(document?.params.jsonTopLevelKeys).toEqual([
      'incident_metadata', 'root_causes', 'affected_resources', 'remediation_plan', 'summary',
    ]);
    expect(document?.params.dataGrounded).toBe(true);
    expect(document?.params.contentFromStep).toBe(1);
  });

  it('carries only the file name into the document step for a markdown spec (M&A shape)', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: '監査報告', format: 'markdown', brief: '監査' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: MD_GOAL,
      ...base,
      setId: 'att-ma-md',
      setDigest: 'digest-ma-md',
      view: viewWith(17, MA_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analyzer = result.steps.find((step) => step.toolName === 'attachment_analyzer');
    expect(analyzer?.params).not.toHaveProperty('structuredJsonKeys');
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.outputFilename).toBe('audit_report.md');
    expect(document?.params.format).toBe('markdown');
    expect(document?.params).not.toHaveProperty('jsonTopLevelKeys');
  });

  it('adds nothing to a plan whose goal names no output file', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: '報告', format: 'markdown', brief: '報告' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: 'このCSVの各行を分類してレポートを作成してください',
      ...base,
      setId: 'att-plain',
      setDigest: 'digest-plain',
      view: viewWith(1, ['fruits.csv']),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params).not.toHaveProperty('outputFilename');
    expect(document?.params).not.toHaveProperty('jsonTopLevelKeys');
    expect(document?.params.format).toBe('markdown');
  });
});

describe('attachment plan inconsistency-audit mode (misreading countermeasure)', () => {
  const MA_GOAL = '添付文書を照合して不整合を監査し、レポートを作成してください';
  const maBase = () => basePlan([
    { toolName: 'document_generator', params: { title: '監査レポート', format: 'markdown', brief: '監査' }, reasonCode: 'document-request' },
    { toolName: 'file_writer', params: { path: 'artifacts/document.md', contentFromPreviousArtifact: true }, reasonCode: 'write-specific-file' },
    { toolName: 'verification_runner', params: {}, reasonCode: 'verification-command' },
  ]);

  it('detects the audit intent separately from the output kind', () => {
    expect(goalRequestsInconsistencyAudit('文書の不整合を監査する')).toBe(true);
    expect(goalRequestsInconsistencyAudit('Run an inconsistency audit of the documents')).toBe(true);
    expect(goalRequestsInconsistencyAudit('audit the consistency of these filings')).toBe(true);
    // A root-cause findings goal is findings, but not an audit.
    expect(goalRequestsInconsistencyAudit('障害の原因を分析してください')).toBe(false);
    expect(goalRequestsInconsistencyAudit('添付文書を分類して一覧化してください')).toBe(false);
  });

  it('marks the analyzers auditMode for an audit goal even with the switch off, and issues no reconciler', () => {
    const result = augmentPlanWithAttachments({
      goal: MA_GOAL,
      ...maBase(),
      setId: 'att-ma',
      setDigest: 'digest-ma',
      view: viewWith(17, MA_FILES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(8);
    const analyzers = result.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.every((step) => step.params.auditMode === true)).toBe(true);
    expect(result.steps.some((step) => step.toolName === 'attachment_reconciler')).toBe(false);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.contentFromStep).toBe(5);
  });

  it('issues the reconciler after the last analyzer while the switch is on, and regrounds the document step on it', () => {
    const result = augmentPlanWithAttachments({
      goal: MA_GOAL,
      ...maBase(),
      setId: 'att-ma',
      setDigest: 'digest-ma',
      view: viewWith(17, MA_FILES),
      reconciliationMode: 'enforce',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 8 steps of the switch-off plan + 1 reconciler.
    expect(result.steps).toHaveLength(9);
    expect(result.plannedSteps.map((step) => step.toolName)).toEqual(result.steps.map((step) => step.toolName));
    const reconcilerIndex = result.steps.findIndex((step) => step.toolName === 'attachment_reconciler');
    expect(reconcilerIndex).toBe(6);
    expect(result.steps[reconcilerIndex]?.params.contentFromStep).toBe(5);
    expect(result.steps[reconcilerIndex]?.params.attachmentSetId).toBe('att-ma');
    expect(result.steps[reconcilerIndex]?.params.setDigest).toBe('digest-ma');
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.contentFromStep).toBe(6);
  });

  it('issues no reconciler and no auditMode for a non-audit findings goal, even in enforce mode', () => {
    const base = basePlan([
      { toolName: 'document_generator', params: { title: '原因分析', format: 'markdown', brief: '分析' }, reasonCode: 'document-request' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付資料を分析して障害の原因を特定してください',
      ...base,
      setId: 'att-k8s',
      setDigest: 'digest-k8s',
      view: viewWith(4, K8S_FILES),
      reconciliationMode: 'enforce',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analyzers = result.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.every((step) => step.params.auditMode === undefined)).toBe(true);
    expect(result.steps.some((step) => step.toolName === 'attachment_reconciler')).toBe(false);
  });

  it('refuses the largest audit shape at plan time: the reconciler counts toward the ceiling', () => {
    const base = basePlan([
      { toolName: 'repository_explorer', params: {}, reasonCode: 'repository-overview' },
      { toolName: 'web_search_grounding', params: { query: '最新動向' }, reasonCode: 'current-research' },
      { toolName: 'code_interpreter', params: { mode: 'generate', instruction: '集計コード' }, reasonCode: 'code-analysis' },
      { toolName: 'document_generator', params: { title: '報告書', format: 'markdown', brief: '報告' }, reasonCode: 'document-request' },
      { toolName: 'image_prompt_compiler', params: { prompt: '図表' }, reasonCode: 'visual-request' },
      { toolName: 'verification_runner', params: {}, reasonCode: 'verification-command' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付文書の不整合を監査し、最新の動向も調査して報告書を作成してください',
      ...base,
      setId: 'att-max-audit',
      setDigest: 'digest-max-audit',
      view: viewWith(48, MA_FILES),
      reconciliationMode: 'shadow',
    });
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.code).toBe('AGENT_ATTACHMENT_TOO_LARGE');
    expect(result.limitKind).toBe('steps');
    expect(result.stepCount).toBe(20);
  });
});
