import { createHash } from 'node:crypto';
import {
  generateArtifactV12,
  type ArtifactRequest,
  type ArtifactSlide,
  type ArtifactType,
} from '../../artifacts/artifactGeneratorV12.js';
import type { OriginAnswerRichOutput } from './OriginAnswerEnvelope.js';
import { containsSensitiveInput } from './SensitiveInputDetector.js';

export const ORIGIN_SUPERVISOR_VERSION_V2 = 'origin.supervisor.v2' as const;

export type OriginSupervisorArtifactKindV2 = 'document' | 'presentation' | 'spreadsheet';

export type OriginSupervisorArtifactPayloadV2 = {
  id: string;
  kind: OriginSupervisorArtifactKindV2;
  artifactType: ArtifactType;
  filename: string;
  mimeType: string;
  sha256: string;
  byteLength: number;
  encoding: 'base64';
  data: string;
  verified: true;
  verification: readonly string[];
  freeOnly: true;
  costUsd: 0;
  paidFallbackUsed: false;
};

export type OriginSupervisorArtifactResultV2 = {
  version: typeof ORIGIN_SUPERVISOR_VERSION_V2;
  status: 'completed' | 'partial' | 'not-required';
  artifacts: readonly OriginSupervisorArtifactPayloadV2[];
  richOutputs: readonly OriginAnswerRichOutput[];
  completedOutputs: readonly string[];
  pendingOutputs: readonly string[];
};

const FILE_OUTPUTS = new Set([
  'presentation',
  'document',
  'spreadsheet',
  'chart',
  'image',
  'application',
  'website',
  'dashboard',
]);
const SUPPORTED_OUTPUTS = new Set<OriginSupervisorArtifactKindV2>([
  'document',
  'presentation',
  'spreadsheet',
]);
const MAX_INLINE_ARTIFACT_BYTES = 1_250_000;
const MAX_INLINE_ARTIFACT_BUNDLE_BYTES = 1_500_000;

function safeTitle(value: string): string {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return (normalized || 'ORIGIN Research Deliverable').slice(0, 160);
}

function cleanLine(value: string): string {
  return value.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').trim();
}

function presentationSlides(title: string, content: string): ArtifactSlide[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current = { title, lines: [] as string[] };

  const pushCurrent = () => {
    if (current.lines.some(line => line.trim()) || sections.length === 0) {
      sections.push({
        title: current.title.slice(0, 200),
        lines: current.lines.filter(line => line.trim()).slice(0, 18),
      });
    }
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (current.lines.some(item => item.trim())) pushCurrent();
      current = { title: heading[1].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some(line => line.trim()) || sections.length === 0) pushCurrent();

  return sections.slice(0, 12).map((section, index) => ({
    title: (section.title || (index === 0 ? title : `Section ${index + 1}`)).slice(0, 200),
    content: section.lines.map(cleanLine).filter(Boolean).join('\n').slice(0, 10_000),
  }));
}

function markdownTableRows(content: string): ArtifactRequest['rows'] | undefined {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = lines[index].trim();
    const divider = lines[index + 1].trim();
    if (!header.includes('|') || !divider.includes('|')) continue;

    const cells = (line: string) => line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim());
    const headers = cells(header);
    const separators = cells(divider);
    if (
      headers.length < 2
      || headers.length !== separators.length
      || !separators.every(cell => /^:?-{3,}:?$/.test(cell))
    ) continue;

    const rows: Array<Array<string | number | boolean | null>> = [headers];
    for (let rowIndex = index + 2; rowIndex < lines.length && rows.length < 1000; rowIndex += 1) {
      if (!lines[rowIndex].includes('|') || !lines[rowIndex].trim()) break;
      const row = cells(lines[rowIndex]);
      if (row.length === headers.length) rows.push(row);
    }
    return rows;
  }
  return undefined;
}

function artifactRequest(
  kind: OriginSupervisorArtifactKindV2,
  title: string,
  content: string,
): ArtifactRequest | null {
  if (kind === 'document') return { type: 'docx', title, content };
  if (kind === 'presentation') {
    return { type: 'pptx', title, content, slides: presentationSlides(title, content) };
  }
  const rows = markdownTableRows(content);
  if (!rows) return null;
  return {
    type: 'xlsx',
    title,
    content,
    rows,
  };
}

function richKind(kind: OriginSupervisorArtifactKindV2): OriginAnswerRichOutput['kind'] {
  return kind;
}

export function generateOriginSupervisorArtifactsV2(
  requestedOutputs: readonly string[],
  titleInput: string,
  contentInput: string,
): OriginSupervisorArtifactResultV2 {
  const requestedFileOutputs = [...new Set(
    requestedOutputs.filter(output => FILE_OUTPUTS.has(output)),
  )];
  if (requestedFileOutputs.length === 0) {
    return {
      version: ORIGIN_SUPERVISOR_VERSION_V2,
      status: 'not-required',
      artifacts: [],
      richOutputs: [],
      completedOutputs: [],
      pendingOutputs: [],
    };
  }

  const title = safeTitle(titleInput);
  const content = contentInput.trim().slice(0, 120_000);
  if (!content) throw new Error('SUPERVISOR_ARTIFACT_CONTENT_EMPTY');
  if (containsSensitiveInput(content)) throw new Error('SUPERVISOR_ARTIFACT_SENSITIVE_OUTPUT_BLOCKED');

  const artifacts: OriginSupervisorArtifactPayloadV2[] = [];
  const richOutputs: OriginAnswerRichOutput[] = [];
  const completedOutputs: string[] = [];
  const pendingOutputs: string[] = [];
  let totalArtifactBytes = 0;

  for (const output of requestedFileOutputs) {
    if (!SUPPORTED_OUTPUTS.has(output as OriginSupervisorArtifactKindV2)) {
      pendingOutputs.push(output);
      continue;
    }

    const kind = output as OriginSupervisorArtifactKindV2;
    const request = artifactRequest(kind, title, content);
    if (!request) {
      pendingOutputs.push(output);
      continue;
    }
    const generated = generateArtifactV12(request);
    if (!generated.verified || generated.bytes.length === 0) {
      throw new Error('SUPERVISOR_ARTIFACT_VERIFICATION_FAILED');
    }
    if (generated.bytes.length > MAX_INLINE_ARTIFACT_BYTES) {
      throw new Error('SUPERVISOR_ARTIFACT_TOO_LARGE');
    }
    if (totalArtifactBytes + generated.bytes.length > MAX_INLINE_ARTIFACT_BUNDLE_BYTES) {
      throw new Error('SUPERVISOR_ARTIFACT_BUNDLE_TOO_LARGE');
    }
    totalArtifactBytes += generated.bytes.length;
    const sha256 = createHash('sha256').update(generated.bytes).digest('hex');
    if (sha256 !== generated.sha256) throw new Error('SUPERVISOR_ARTIFACT_DIGEST_MISMATCH');

    const id = `artifact-${generated.type}-${generated.sha256.slice(0, 20)}`;
    artifacts.push({
      id,
      kind,
      artifactType: generated.type,
      filename: generated.filename,
      mimeType: generated.mimeType,
      sha256: generated.sha256,
      byteLength: generated.bytes.length,
      encoding: 'base64',
      data: generated.bytes.toString('base64'),
      verified: true,
      verification: [...generated.verification],
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    });
    richOutputs.push({
      kind: richKind(kind),
      label: generated.filename,
      artifactId: id,
    });
    completedOutputs.push(output);
  }

  return {
    version: ORIGIN_SUPERVISOR_VERSION_V2,
    status: pendingOutputs.length === 0 ? 'completed' : 'partial',
    artifacts,
    richOutputs,
    completedOutputs,
    pendingOutputs,
  };
}
