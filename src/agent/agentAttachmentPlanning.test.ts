// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AGENT_ATTACHMENT_MAX_PLAN_STEPS,
  attachmentOutputKindForGoal,
  augmentPlanWithAttachments,
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
  it('derives the ceiling from the parts it must hold: 6 base + reader + 6 analyzers = 13', () => {
    expect(AGENT_ATTACHMENT_MAX_PLAN_STEPS).toBe(13);
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
    // 3 base + 1 reader + ceil(17/8)=3 analyzers = 7 — refused by the
    // old flat ceiling of 6.
    expect(result.steps).toHaveLength(7);
    expect(result.plannedSteps.map((step) => step.toolName)).toEqual(result.steps.map((step) => step.toolName));
    const analyzers = result.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.map((step) => step.params.chunkCount)).toEqual([8, 8, 1]);
    expect(analyzers[1].params.contentFromStep).toBe(1);
    expect(analyzers[2].params.contentFromStep).toBe(2);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.dataGrounded).toBe(true);
    expect(document?.params.contentFromStep).toBe(3);
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
    expect(analyzers.map((step) => step.params.chunkCount)).toEqual([8, 8, 8, 8, 3]);
    const document = result.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.contentFromStep).toBe(5);
  });

  it('admits the largest admissible shape: 48 chunks on a full 6-step base plan (13 steps)', () => {
    const base = basePlan([
      { toolName: 'repository_explorer', params: {}, reasonCode: 'repository-overview' },
      { toolName: 'web_search_grounding', params: { query: '最新動向' }, reasonCode: 'current-research' },
      { toolName: 'code_interpreter', params: { mode: 'generate', instruction: '集計コード' }, reasonCode: 'code-analysis' },
      { toolName: 'document_generator', params: { title: '報告書', format: 'markdown', brief: '報告' }, reasonCode: 'document-request' },
      { toolName: 'file_writer', params: { path: 'artifacts/document.md', contentFromPreviousArtifact: true }, reasonCode: 'write-specific-file' },
      { toolName: 'verification_runner', params: {}, reasonCode: 'verification-command' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付データを分析して報告書を作成してください',
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
      { toolName: 'verification_runner', params: {}, reasonCode: 'verification-command' },
    ]);
    const result = augmentPlanWithAttachments({
      goal: '添付データを分析して報告書を作成してください',
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
    expect(result.stepCount).toBe(14);
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
  it('drops the goal-token file_reader and normalizes the file_writer path (K8s shape)', () => {
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
      'file_writer',
    ]);
    expect(result.plannedSteps.map((step) => step.toolName)).toEqual(result.steps.map((step) => step.toolName));
    for (const step of result.steps) {
      expect(step.params.path).not.toBe('payment-api');
    }
    const writer = result.steps[result.steps.length - 1];
    expect(writer.params.path).toBe('artifacts/attachment-result.md');
    // The content chaining survives: the writer still persists the
    // grounded document artifact, only the fabricated name is gone.
    expect(writer.params.contentFromPreviousArtifact).toBe(true);
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

  it('leaves an artifacts/ file_writer path untouched', () => {
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
    const writer = result.steps[result.steps.length - 1];
    expect(writer.params.path).toBe('artifacts/report.md');
  });

  it('still regrounds a first-step file_writer and keeps a set-file path', () => {
    const base = basePlan([
      { toolName: 'file_writer', params: { path: 'deployment.yaml', content: 'fabricated draft' }, reasonCode: 'write-specific-file' },
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
    const writer = result.steps[result.steps.length - 1];
    expect(writer.toolName).toBe('file_writer');
    expect(writer.params.path).toBe('deployment.yaml');
    expect(writer.params.contentFromStep).toBe(1);
    expect(writer.params).not.toHaveProperty('content');
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
