import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import express from 'express';

import { createArtifactV12Router } from '../src/artifacts/artifactV12Router.js';
import { createWebAppBuilderV13Router } from '../src/builder/webAppBuilderV13Router.js';
import { createOriginChatRouter } from '../src/legacy/originChatRouter.js';
import {
  validateArtifactPrivateCorpusV1,
  type ArtifactPrivateTaskV1,
  type OriginArtifactPrivateCorpusV1,
} from '../src/release/OriginArtifactPrivateCorpusV1.js';
import type {
  ArtifactBenchmarkOutputV1,
  ArtifactTechnicalEvidenceV1,
} from '../src/release/OriginArtifactBlindBenchmarkV1.js';

type JsonRecord = Record<string, any>;

type CandidateCaseEvidence = {
  caseId: string;
  family: ArtifactPrivateTaskV1['family'];
  challengeTags: ArtifactPrivateTaskV1['challengeTags'];
  promptSha256: string;
  expectedFormat: ArtifactPrivateTaskV1['expectedFormat'];
  taskDigest: string;
  output: ArtifactBenchmarkOutputV1;
  failureCode: string | null;
  providerId: string | null;
  modelId: string | null;
};

const MAX_CORPUS_B64 = 4_000_000;
const MAX_CORPUS_BYTES = 4_000_000;
const EMPTY_SHA256 = createHash('sha256').update(Buffer.alloc(0)).digest('hex');

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`ARTIFACT_PRIVATE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeFailureCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_:.-]{0,180}$/.test(value) ? value : fallback;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

async function jsonOrNull(response: Response): Promise<JsonRecord | null> {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

async function postJson(baseUrl: string, route: string, body: unknown, timeoutMs: number): Promise<Response> {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(Math.min(Math.max(timeoutMs, 10_000), 120_000)),
  });
}

function parseMarkdownTable(content: string): Array<Array<string | number | boolean | null>> {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const cells = (line: string) => line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((value) => value.trim());

  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = lines[index].trim();
    const divider = lines[index + 1].trim();
    if (!header.includes('|') || !divider.includes('|')) continue;
    const headers = cells(header);
    const separators = cells(divider);
    if (
      headers.length < 2
      || headers.length !== separators.length
      || !separators.every((value) => /^:?-{3,}:?$/.test(value))
    ) continue;

    const rows: Array<Array<string | number | boolean | null>> = [headers];
    for (let rowIndex = index + 2; rowIndex < lines.length && rows.length < 500; rowIndex += 1) {
      const raw = lines[rowIndex].trim();
      if (!raw || !raw.includes('|')) break;
      const row = cells(raw);
      if (row.length !== headers.length) break;
      rows.push(row);
    }
    return rows;
  }

  return lines
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => [line]);
}

function presentationSlides(content: string): Array<{ title: string; content: string }> {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current = { title: 'Overview', lines: [] as string[] };

  const push = () => {
    if (current.lines.some((line) => line.trim()) || sections.length === 0) {
      sections.push({
        title: current.title.slice(0, 160),
        lines: current.lines.filter((line) => line.trim()).slice(0, 20),
      });
    }
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (current.lines.some((item) => item.trim())) push();
      current = { title: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  push();

  if (sections.length === 1) {
    const paragraphs = content.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
    if (paragraphs.length >= 2) {
      return paragraphs.slice(0, 8).map((paragraph, index) => ({
        title: index === 0 ? 'Overview' : `Section ${index + 1}`,
        content: paragraph.slice(0, 5000),
      }));
    }
  }

  return sections.slice(0, 12).map((section) => ({
    title: section.title,
    content: section.lines
      .map((line) => line.replace(/^\s*[-*+]\s+/, '• ').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 10_000),
  }));
}

function firstMeaningfulLine(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .find(Boolean)
    ?.slice(0, 80) || 'ORIGIN Artifact Benchmark';
}

function webSpec(task: ArtifactPrivateTaskV1, content: string): JsonRecord {
  const title = firstMeaningfulLine(content);
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((value) => value.replace(/^#{1,6}\s+/gm, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const items = paragraphs.slice(1, 7).map((paragraph, index) => ({
    title: `Section ${index + 1}`,
    body: paragraph.slice(0, 700),
  }));
  const kind = task.family === 'web-landing-page'
    ? 'landing'
    : task.family === 'web-interactive-app'
      ? 'webapp'
      : 'dashboard';

  return {
    kind,
    name: title,
    description: paragraphs[0]?.slice(0, 500) || content.slice(0, 500),
    locale: /[ぁ-んァ-ヶ一-龠]/.test(content) ? 'ja' : 'en',
    theme: 'system',
    accent: 'indigo',
    pages: [{
      title,
      headline: title,
      subheadline: paragraphs[0]?.slice(0, 500) || '',
      action: { label: 'Explore', href: '#section-1' },
      sections: [{
        eyebrow: 'ORIGIN',
        title: 'Overview',
        body: paragraphs[0]?.slice(0, 1200) || content.slice(0, 1200),
        layout: task.family === 'web-interactive-app' ? 'steps' : 'cards',
        items: items.length ? items : [{ title: 'Summary', body: content.slice(0, 700) }],
      }],
    }],
  };
}

function artifactRequest(task: ArtifactPrivateTaskV1, content: string): JsonRecord {
  const title = firstMeaningfulLine(content);
  if (task.expectedFormat === 'xlsx' || task.expectedFormat === 'csv') {
    return { type: task.expectedFormat, title, content, rows: parseMarkdownTable(content) };
  }
  if (task.expectedFormat === 'pptx') {
    return { type: 'pptx', title, content, slides: presentationSlides(content) };
  }
  return { type: task.expectedFormat, title, content };
}

function byteText(bytes: Buffer): string {
  return bytes.toString('utf8');
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4
    && bytes.readUInt32LE(0) === 0x04034b50
    && bytes.includes(Buffer.from('PK\u0005\u0006', 'binary'));
}

function formatSignaturePassed(format: ArtifactPrivateTaskV1['expectedFormat'], bytes: Buffer): boolean {
  if (['docx', 'xlsx', 'pptx', 'html-zip'].includes(format)) return isZip(bytes);
  if (format === 'pdf') return bytes.subarray(0, 5).toString('binary') === '%PDF-' && bytes.includes(Buffer.from('%%EOF', 'ascii'));
  if (format === 'csv' || format === 'markdown') return bytes.length > 0 && !bytes.includes(Buffer.from([0]));
  return false;
}

function formatStructurePassed(format: ArtifactPrivateTaskV1['expectedFormat'], bytes: Buffer): boolean {
  if (format === 'docx') return bytes.includes(Buffer.from('word/document.xml')) && bytes.includes(Buffer.from('word/styles.xml'));
  if (format === 'xlsx') return bytes.includes(Buffer.from('xl/workbook.xml')) && bytes.includes(Buffer.from('xl/worksheets/sheet1.xml')) && bytes.includes(Buffer.from('xl/styles.xml'));
  if (format === 'pptx') return bytes.includes(Buffer.from('ppt/presentation.xml')) && bytes.includes(Buffer.from('ppt/slides/slide1.xml')) && bytes.includes(Buffer.from('ppt/theme/theme1.xml'));
  if (format === 'html-zip') return bytes.includes(Buffer.from('index.html')) && bytes.includes(Buffer.from('assets/styles.css')) && bytes.includes(Buffer.from('assets/app.js')) && bytes.includes(Buffer.from('origin-manifest.json'));
  if (format === 'pdf') return bytes.includes(Buffer.from('/MediaBox')) && bytes.includes(Buffer.from('xref'));
  return format === 'csv' || format === 'markdown';
}

function expectedMime(format: ArtifactPrivateTaskV1['expectedFormat']): string {
  if (format === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (format === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (format === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (format === 'pdf') return 'application/pdf';
  if (format === 'html-zip') return 'application/zip';
  if (format === 'csv') return 'text/csv';
  return 'text/markdown';
}

function requirementPassed(
  requirement: ArtifactPrivateTaskV1['technicalRequirements'][number],
  task: ArtifactPrivateTaskV1,
  bytes: Buffer,
): boolean {
  const text = byteText(bytes);
  if (requirement === 'required-content') {
    return task.requiredContent.every((value) => bytes.includes(Buffer.from(value, 'utf8')));
  }
  if (requirement === 'structured-headings') {
    return text.includes('Heading1') || text.includes('Heading2') || /#{1,3}\s+/.test(text);
  }
  if (requirement === 'table-structure') {
    if (task.expectedFormat === 'xlsx') return text.includes('<row r="2"') && /<c r="[A-Z]+1"/.test(text);
    if (task.expectedFormat === 'csv') return text.split(/\r?\n/).filter(Boolean).length >= 2 && text.includes(',');
    return text.includes('|');
  }
  if (requirement === 'multi-slide') return text.includes('ppt/slides/slide2.xml');
  if (requirement === 'responsive-layout') return text.includes('@media(max-width') || text.includes('@media (max-width');
  if (requirement === 'offline-runtime') {
    return text.includes("connect-src 'none'") && !text.includes('fetch(') && !text.includes('XMLHttpRequest') && !text.includes('WebSocket');
  }
  if (requirement === 'editable-source') {
    if (task.expectedFormat === 'docx') return text.includes('word/document.xml');
    if (task.expectedFormat === 'xlsx') return text.includes('xl/worksheets/sheet1.xml');
    if (task.expectedFormat === 'pptx') return text.includes('ppt/slides/slide1.xml');
    if (task.expectedFormat === 'html-zip') return text.includes('index.html') && text.includes('assets/styles.css');
    return task.expectedFormat === 'csv' || task.expectedFormat === 'markdown';
  }
  if (requirement === 'multi-section') {
    if (task.expectedFormat === 'pdf') return (text.match(/ Tj/g) ?? []).length >= 6;
    if (task.expectedFormat === 'pptx') return text.includes('ppt/slides/slide2.xml');
    if (task.expectedFormat === 'docx') return (text.match(/Heading[12]/g) ?? []).length >= 2;
    if (task.expectedFormat === 'html-zip') return (text.match(/class="section/g) ?? []).length >= 1;
    return text.split(/\r?\n/).filter(Boolean).length >= 4;
  }
  return false;
}

function layoutPassed(format: ArtifactPrivateTaskV1['expectedFormat'], bytes: Buffer): boolean {
  const text = byteText(bytes);
  if (format === 'docx') return text.includes('<w:pgSz') && text.includes('<w:pgMar');
  if (format === 'xlsx') return text.includes('<pane ySplit="1"') && text.includes('<cols>');
  if (format === 'pptx') return text.includes('<p:sldSz') && text.includes('type="screen16x9"');
  if (format === 'pdf') return text.includes('/MediaBox [0 0 595 842]');
  if (format === 'html-zip') return text.includes('@media(max-width') || text.includes('@media (max-width');
  return true;
}

function editabilityPassed(format: ArtifactPrivateTaskV1['expectedFormat'], bytes: Buffer): boolean {
  const text = byteText(bytes);
  if (format === 'docx') return text.includes('word/document.xml');
  if (format === 'xlsx') return text.includes('xl/worksheets/sheet1.xml');
  if (format === 'pptx') return text.includes('ppt/slides/slide1.xml');
  if (format === 'html-zip') return text.includes('index.html') && text.includes('assets/styles.css') && text.includes('assets/app.js');
  if (format === 'csv' || format === 'markdown') return true;
  // PDF is intentionally immutable as a delivery format; source text remains in-memory
  // during generation and is not persisted as private benchmark material.
  return format === 'pdf';
}

function chatPolicy(body: JsonRecord): { ok: boolean; providerId: string | null; modelId: string | null } {
  const routing = record(body.routing);
  const providerRouting = record(routing?.providerRouting);
  const usage = record(routing?.usage);
  const policy = record(routing?.providerDataPolicy);
  const modelId = typeof routing?.modelId === 'string' ? routing.modelId : null;
  const providerId = typeof routing?.providerId === 'string' ? routing.providerId : null;
  const served = typeof providerRouting?.servedModel === 'string' ? providerRouting.servedModel : '';
  const canonical = modelId?.replace(/:free$/i, '') ?? '';
  const ok = Boolean(
    routing
    && routing.freeOnly === true
    && routing.actualCostUsd === 0
    && routing.estimatedCostUsd === 0
    && routing.providerAttempts === 1
    && providerId
    && modelId
    && providerRouting
    && providerRouting.requestedModel === modelId
    && (served === modelId || served === canonical)
    && providerRouting.fallbackUsed === false
    && usage
    && usage.costUsd === 0
    && policy
    && policy.allowProviderFallbacks === false
    && policy.dataCollection === 'deny'
    && policy.requireZeroDataRetention === true
  );
  return { ok, providerId, modelId };
}

function classifyFailure(status: number, body: JsonRecord | null): ArtifactBenchmarkOutputV1['executionStatus'] {
  if (status === 429 || body?.code === 'PROVIDER_RATE_LIMITED') return 'quota-limited';
  if (status >= 400 && status < 500) return 'blocked';
  return 'failed';
}

function emptyTechnical(): ArtifactTechnicalEvidenceV1 {
  return {
    formatValid: false,
    opensSuccessfully: false,
    requiredContentPassed: false,
    taskSpecificChecksPassed: false,
    noCorruption: false,
    safeDeliveryPassed: false,
    editabilityVerified: false,
    responsiveOrLayoutPassed: false,
  };
}

async function evaluateCase(
  baseUrl: string,
  task: ArtifactPrivateTaskV1,
  caseIndex: number,
  executionBudgetMs: number,
  outputDir: string,
): Promise<CandidateCaseEvidence> {
  const startedAt = Date.now();
  let chat: Response;
  try {
    chat = await postJson(baseUrl, '/api/chat', {
      messages: [{ role: 'user', content: task.prompt }],
      executionPolicy: {
        maxEstimatedCostUsd: 0,
        timeoutMs: Math.min(executionBudgetMs, 120_000),
      },
    }, Math.min(executionBudgetMs, 70_000));
  } catch {
    return {
      caseId: task.caseId,
      family: task.family,
      challengeTags: task.challengeTags,
      promptSha256: task.promptSha256,
      expectedFormat: task.expectedFormat,
      taskDigest: task.taskDigest,
      output: {
        blindKey: 'ORIGIN',
        systemId: 'origin-artifact-v1',
        role: 'origin',
        executionStatus: 'failed',
        durationMs: Date.now() - startedAt,
        artifactSha256: EMPTY_SHA256,
        technical: emptyTechnical(),
      },
      failureCode: 'ARTIFACT_PRIVATE_CHAT_FETCH_FAILED',
      providerId: null,
      modelId: null,
    };
  }

  const chatBody = await jsonOrNull(chat);
  if (!chat.ok || !chatBody) {
    return {
      caseId: task.caseId,
      family: task.family,
      challengeTags: task.challengeTags,
      promptSha256: task.promptSha256,
      expectedFormat: task.expectedFormat,
      taskDigest: task.taskDigest,
      output: {
        blindKey: 'ORIGIN',
        systemId: 'origin-artifact-v1',
        role: 'origin',
        executionStatus: classifyFailure(chat.status, chatBody),
        durationMs: Date.now() - startedAt,
        artifactSha256: EMPTY_SHA256,
        technical: emptyTechnical(),
      },
      failureCode: safeFailureCode(chatBody?.code, `ARTIFACT_PRIVATE_CHAT_HTTP_${chat.status}`),
      providerId: null,
      modelId: null,
    };
  }

  const content = typeof chatBody.content === 'string'
    ? chatBody.content
    : typeof record(chatBody.answer)?.answer === 'string'
      ? record(chatBody.answer)?.answer
      : '';
  const policy = chatPolicy(chatBody);
  if (!content || !policy.ok) {
    return {
      caseId: task.caseId,
      family: task.family,
      challengeTags: task.challengeTags,
      promptSha256: task.promptSha256,
      expectedFormat: task.expectedFormat,
      taskDigest: task.taskDigest,
      output: {
        blindKey: 'ORIGIN',
        systemId: 'origin-artifact-v1',
        role: 'origin',
        executionStatus: 'blocked',
        durationMs: Date.now() - startedAt,
        artifactSha256: EMPTY_SHA256,
        technical: emptyTechnical(),
      },
      failureCode: content ? 'ARTIFACT_PRIVATE_CHAT_ZERO_COST_POLICY_INVALID' : 'ARTIFACT_PRIVATE_CHAT_EMPTY',
      providerId: policy.providerId,
      modelId: policy.modelId,
    };
  }

  let artifactResponse: Response;
  try {
    if (task.expectedFormat === 'html-zip') {
      artifactResponse = await postJson(
        baseUrl,
        '/api/builder/v1.3/generate',
        webSpec(task, content),
        Math.min(executionBudgetMs, 30_000),
      );
    } else {
      artifactResponse = await postJson(
        baseUrl,
        '/api/artifacts/v1.2/generate',
        artifactRequest(task, content),
        Math.min(executionBudgetMs, 30_000),
      );
    }
  } catch {
    return {
      caseId: task.caseId,
      family: task.family,
      challengeTags: task.challengeTags,
      promptSha256: task.promptSha256,
      expectedFormat: task.expectedFormat,
      taskDigest: task.taskDigest,
      output: {
        blindKey: 'ORIGIN',
        systemId: 'origin-artifact-v1',
        role: 'origin',
        executionStatus: 'failed',
        durationMs: Date.now() - startedAt,
        artifactSha256: EMPTY_SHA256,
        technical: emptyTechnical(),
      },
      failureCode: 'ARTIFACT_PRIVATE_GENERATOR_FETCH_FAILED',
      providerId: policy.providerId,
      modelId: policy.modelId,
    };
  }

  if (!artifactResponse.ok) {
    const errorBody = await jsonOrNull(artifactResponse);
    return {
      caseId: task.caseId,
      family: task.family,
      challengeTags: task.challengeTags,
      promptSha256: task.promptSha256,
      expectedFormat: task.expectedFormat,
      taskDigest: task.taskDigest,
      output: {
        blindKey: 'ORIGIN',
        systemId: 'origin-artifact-v1',
        role: 'origin',
        executionStatus: classifyFailure(artifactResponse.status, errorBody),
        durationMs: Date.now() - startedAt,
        artifactSha256: EMPTY_SHA256,
        technical: emptyTechnical(),
      },
      failureCode: safeFailureCode(errorBody?.code, `ARTIFACT_PRIVATE_GENERATOR_HTTP_${artifactResponse.status}`),
      providerId: policy.providerId,
      modelId: policy.modelId,
    };
  }

  const bytes = Buffer.from(await artifactResponse.arrayBuffer());
  const actualSha = sha256(bytes);
  const isWeb = task.expectedFormat === 'html-zip';
  const headerSha = artifactResponse.headers.get(isWeb ? 'x-origin-project-sha256' : 'x-origin-artifact-sha256') ?? '';
  const verifiedHeader = artifactResponse.headers.get(isWeb ? 'x-origin-project-verified' : 'x-origin-artifact-verified');
  const freeHeader = artifactResponse.headers.get('x-origin-free-only');
  const costHeader = artifactResponse.headers.get('x-origin-cost-usd');
  const paidHeader = artifactResponse.headers.get('x-origin-paid-fallback');
  const mime = (artifactResponse.headers.get('content-type') ?? '').toLowerCase();
  const signaturePassed = formatSignaturePassed(task.expectedFormat, bytes);
  const structurePassed = formatStructurePassed(task.expectedFormat, bytes);
  const technicalRequirementsPassed = task.technicalRequirements.every((requirement) =>
    requirementPassed(requirement, task, bytes));

  const technical: ArtifactTechnicalEvidenceV1 = {
    formatValid: signaturePassed && mime.startsWith(expectedMime(task.expectedFormat)),
    opensSuccessfully: signaturePassed && structurePassed,
    requiredContentPassed: task.requiredContent.every((value) => bytes.includes(Buffer.from(value, 'utf8'))),
    taskSpecificChecksPassed: technicalRequirementsPassed,
    noCorruption: bytes.length > 0 && headerSha === actualSha && verifiedHeader === 'true',
    safeDeliveryPassed: policy.ok
      && freeHeader === 'true'
      && costHeader === '0'
      && (isWeb ? paidHeader === 'false' : true),
    editabilityVerified: editabilityPassed(task.expectedFormat, bytes),
    responsiveOrLayoutPassed: layoutPassed(task.expectedFormat, bytes),
  };

  const extension = task.expectedFormat === 'html-zip'
    ? 'zip'
    : task.expectedFormat === 'markdown'
      ? 'md'
      : task.expectedFormat;
  if (!Number.isInteger(caseIndex) || caseIndex < 0 || caseIndex >= 16) {
    throw new Error('ARTIFACT_PRIVATE_CASE_INDEX_INVALID');
  }
  const artifactFile = `case-${String(caseIndex + 1).padStart(2, '0')}.${extension}`;
  const networkWriteSafe = signaturePassed
    && structurePassed
    && bytes.length > 0
    && headerSha === actualSha
    && verifiedHeader === 'true'
    && policy.ok
    && freeHeader === 'true'
    && costHeader === '0'
    && (isWeb ? paidHeader === 'false' : true);
  if (networkWriteSafe) {
    // Intentional benchmark evidence capture from the in-process loopback runtime after
    // binary/package, integrity, verification-header, and zero-cost delivery validation.
    // codeql[js/http-to-file-access]
    await fs.writeFile(path.join(outputDir, artifactFile), bytes, { mode: 0o600 });
  }

  return {
    caseId: task.caseId,
    family: task.family,
    challengeTags: task.challengeTags,
    promptSha256: task.promptSha256,
    expectedFormat: task.expectedFormat,
    taskDigest: task.taskDigest,
    output: {
      blindKey: 'ORIGIN',
      systemId: 'origin-artifact-v1',
      role: 'origin',
      executionStatus: 'completed',
      durationMs: Date.now() - startedAt,
      artifactSha256: actualSha,
      technical,
    },
    failureCode: Object.values(technical).every(Boolean) ? null : 'ARTIFACT_PRIVATE_TECHNICAL_VALIDATION_FAILED',
    providerId: policy.providerId,
    modelId: policy.modelId,
  };
}

async function main(): Promise<void> {
  const candidateSha = requiredEnv('ORIGIN_ARTIFACT_CANDIDATE_SHA').toLowerCase();
  const expectedCorpusId = requiredEnv('ORIGIN_ARTIFACT_CORPUS_ID');
  const encoded = requiredEnv('ORIGIN_ARTIFACT_PRIVATE_CORPUS_GZIP_B64');
  requiredEnv('OPENROUTER_API_KEY');
  const outputRoot = path.resolve(process.env.ORIGIN_ARTIFACT_OUTPUT_DIR ?? 'test-results/artifact-private');
  const artifactsDir = path.join(outputRoot, 'candidate-artifacts');

  if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error('ARTIFACT_PRIVATE_CANDIDATE_SHA_INVALID');
  if (encoded.length > MAX_CORPUS_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('ARTIFACT_PRIVATE_CORPUS_ENCODING_INVALID');
  }

  let raw: Buffer;
  let corpus: OriginArtifactPrivateCorpusV1;
  try {
    raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_CORPUS_BYTES });
    corpus = JSON.parse(raw.toString('utf8')) as OriginArtifactPrivateCorpusV1;
  } catch {
    throw new Error('ARTIFACT_PRIVATE_CORPUS_PARSE_FAILED');
  }

  const blockers = [...validateArtifactPrivateCorpusV1(corpus)];
  if (corpus.corpusId !== expectedCorpusId) blockers.push('ARTIFACT_PRIVATE_CORPUS_ID_MISMATCH');
  if (corpus.candidateSha.toLowerCase() !== candidateSha) blockers.push('ARTIFACT_PRIVATE_CORPUS_SHA_MISMATCH');
  if (blockers.length > 0) throw new Error('ARTIFACT_PRIVATE_CORPUS_VALIDATION_FAILED');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(createOriginChatRouter({ env: process.env }));
  app.use(createArtifactV12Router());
  app.use(createWebAppBuilderV13Router());
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const corpusDigest = sha256(raw);
  const runBlockers: string[] = [];
  const cases: CandidateCaseEvidence[] = [];

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('ARTIFACT_PRIVATE_SERVER_BIND_FAILED');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fs.mkdir(artifactsDir, { recursive: true });

    for (const [caseIndex, task] of corpus.tasks.entries()) {
      const item = await evaluateCase(baseUrl, task, caseIndex, corpus.executionBudgetMs, artifactsDir);
      cases.push(item);
      if (item.output.durationMs > corpus.executionBudgetMs) {
        runBlockers.push(`ARTIFACT_PRIVATE_EXECUTION_BUDGET_EXCEEDED:${item.caseId}`);
      }
    }

    const identities = new Set(
      cases
        .filter((item) => item.providerId && item.modelId)
        .map((item) => `${item.providerId}::${item.modelId}`),
    );
    if (identities.size !== 1) runBlockers.push('ARTIFACT_PRIVATE_PROVIDER_IDENTITY_DRIFT');

    const publicTasks = corpus.tasks.map((task) => ({
      caseId: task.caseId,
      family: task.family,
      challengeTags: [...task.challengeTags],
      promptSha256: task.promptSha256,
      expectedFormat: task.expectedFormat,
      taskDigest: task.taskDigest,
    }));

    const sanitizedCases = cases.map((item) => ({
      caseId: item.caseId,
      family: item.family,
      challengeTags: [...item.challengeTags],
      promptSha256: item.promptSha256,
      expectedFormat: item.expectedFormat,
      taskDigest: item.taskDigest,
      output: item.output,
      failureCode: item.failureCode,
      providerId: item.providerId,
      modelId: item.modelId,
    }));

    const completed = cases.filter((item) => item.output.executionStatus === 'completed').length;
    const technicallyPassed = cases.filter((item) =>
      item.output.executionStatus === 'completed' && Object.values(item.output.technical).every(Boolean)).length;

    await fs.writeFile(path.join(outputRoot, 'public-tasks.json'), JSON.stringify({
      schemaVersion: 'origin.artifact-private-public-tasks.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      executionBudgetMs: corpus.executionBudgetMs,
      tasks: publicTasks,
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    await fs.writeFile(path.join(outputRoot, 'candidate-evidence.json'), JSON.stringify({
      schemaVersion: 'origin.artifact-private-candidate-evidence.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      evaluatorSha: candidateSha,
      originSystemId: 'origin-artifact-v1',
      executionBudgetMs: corpus.executionBudgetMs,
      providerIdentities: [...identities],
      cases: sanitizedCases,
      blockers: [...new Set(runBlockers)],
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    await fs.writeFile(path.join(outputRoot, 'candidate-summary.json'), JSON.stringify({
      schemaVersion: 'origin.artifact-private-candidate-summary.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      attempted: cases.length,
      completed,
      technicallyPassed,
      providerIdentityCount: identities.size,
      blockers: [...new Set(runBlockers)],
      failures: cases
        .filter((item) => item.failureCode)
        .map((item) => ({ caseId: item.caseId, failureCode: item.failureCode })),
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    process.stdout.write(JSON.stringify({
      event: 'artifact-private-round-completed',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      attempted: cases.length,
      completed,
      technicallyPassed,
      providerIdentityCount: identities.size,
      blockerCount: new Set(runBlockers).size,
    }) + '\n');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  process.stderr.write((/^[A-Z0-9_:-]{3,200}$/.test(message) ? message : 'ARTIFACT_PRIVATE_RUN_FAILED') + '\n');
  process.exitCode = 1;
});
