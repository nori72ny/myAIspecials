import { generateArtifactV12, type ArtifactRequest, type ArtifactType } from '../artifacts/artifactGeneratorV12.js';

export const RESEARCH_ARTIFACT_SUPERVISOR_VERSION_V1 = 'origin.research-artifact-supervisor.v1' as const;
export const RESEARCH_ARTIFACT_OUTPUTS_V1 = ['presentation', 'document', 'spreadsheet'] as const;
export type ResearchArtifactOutputV1 = (typeof RESEARCH_ARTIFACT_OUTPUTS_V1)[number];

const MAX_INLINE_ARTIFACT_BYTES = 1_500_000;
const MAX_SLIDES = 12;
const MAX_SLIDE_BODY_CHARS = 3_200;

export type ResearchSupervisorArtifactV1 = {
  version: typeof RESEARCH_ARTIFACT_SUPERVISOR_VERSION_V1;
  output: ResearchArtifactOutputV1;
  format: Extract<ArtifactType, 'docx' | 'xlsx' | 'pptx'>;
  filename: string;
  mimeType: string;
  bytesBase64: string;
  bytes: number;
  sha256: string;
  verified: true;
  verification: readonly string[];
  freeOnly: true;
  costUsd: 0;
  paidFallbackUsed: false;
  provenance: {
    derivedFrom: 'grounded-research-synthesis';
    citationValidated: true;
    sourceCount: number;
  };
};

export type ResearchArtifactSupervisorResultV1 =
  | { ok: true; artifact: ResearchSupervisorArtifactV1 }
  | {
      ok: false;
      code:
        | 'RESEARCH_ARTIFACT_NOT_REQUESTED'
        | 'RESEARCH_ARTIFACT_MULTIPLE_OUTPUTS_UNSUPPORTED'
        | 'RESEARCH_ARTIFACT_TABLE_REQUIRED'
        | 'RESEARCH_ARTIFACT_GENERATION_FAILED'
        | 'RESEARCH_ARTIFACT_TOO_LARGE';
    };

type BuildInput = {
  query: string;
  synthesis: string;
  requestedOutputs: readonly string[];
  language: 'ja' | 'en';
  sourceCount: number;
};

function supportedOutputs(values: readonly string[]): ResearchArtifactOutputV1[] {
  return [...new Set(values.filter((value): value is ResearchArtifactOutputV1 =>
    (RESEARCH_ARTIFACT_OUTPUTS_V1 as readonly string[]).includes(value)))];
}

function titleFromQuery(query: string, language: 'ja' | 'en'): string {
  const compact = query.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!compact) return language === 'ja' ? 'ORIGIN 調査資料' : 'ORIGIN Research';
  const withoutTail = compact
    .replace(/(?:に)?まとめて(?:ください|下さい)?[。.!！]?$/u, '')
    .replace(/(?:を)?作成して(?:ください|下さい)?[。.!！]?$/u, '')
    .replace(/(?:please\s+)?(?:create|make|build)\s+(?:a\s+)?(?:presentation|document|spreadsheet)[.!]?$/i, '')
    .trim();
  return (withoutTail || compact).slice(0, 80);
}

function extractCitationLinks(text: string): Array<{ label: string; url: string }> {
  const seen = new Set<string>();
  const citations: Array<{ label: string; url: string }> = [];
  for (const match of text.matchAll(/\[(S\d+)\]\((https:\/\/[^\s)]+)\)/g)) {
    const key = `${match[1]}|${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ label: match[1], url: match[2] });
  }
  return citations.slice(0, 24);
}

function compactMarkdownForOffice(text: string): string {
  return text
    .replace(/\[(S\d+)\]\((https:\/\/[^\s)]+)\)/g, '[$1]')
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^```$/gm, '')
    .trim();
}

function documentRequest(input: BuildInput, title: string): ArtifactRequest {
  const citations = extractCitationLinks(input.synthesis);
  const sources = citations.length
    ? `\n\n## ${input.language === 'ja' ? '出典' : 'Sources'}\n${citations.map((citation) => `- [${citation.label}] ${citation.url}`).join('\n')}`
    : '';
  return {
    type: 'docx',
    title,
    content: `${compactMarkdownForOffice(input.synthesis)}${sources}`,
  };
}

function presentationSlides(input: BuildInput, title: string): NonNullable<ArtifactRequest['slides']> {
  const normalized = input.synthesis.replace(/\r\n?/g, '\n');
  const heading = /^##\s+(.+)$/gm;
  const matches = [...normalized.matchAll(heading)];
  const sections: Array<{ title: string; content: string }> = [];

  if (matches.length > 0) {
    for (let index = 0; index < matches.length; index += 1) {
      const current = matches[index];
      const next = matches[index + 1];
      const bodyStart = (current.index ?? 0) + current[0].length;
      const bodyEnd = next?.index ?? normalized.length;
      const body = compactMarkdownForOffice(normalized.slice(bodyStart, bodyEnd))
        .replace(/^#{1,6}\s+/gm, '')
        .trim();
      if (!body) continue;
      sections.push({
        title: current[1].trim().slice(0, 120),
        content: body.slice(0, MAX_SLIDE_BODY_CHARS),
      });
    }
  }

  if (sections.length === 0) {
    const paragraphs = compactMarkdownForOffice(normalized)
      .split(/\n\s*\n/)
      .map((value) => value.replace(/^#{1,6}\s+/gm, '').trim())
      .filter(Boolean);
    for (let index = 0; index < paragraphs.length; index += 2) {
      const chunk = paragraphs.slice(index, index + 2).join('\n\n').slice(0, MAX_SLIDE_BODY_CHARS);
      if (chunk) sections.push({
        title: input.language === 'ja' ? `要点 ${Math.floor(index / 2) + 1}` : `Key point ${Math.floor(index / 2) + 1}`,
        content: chunk,
      });
    }
  }

  const slides: NonNullable<ArtifactRequest['slides']> = [{
    title,
    content: input.language === 'ja'
      ? 'Grounded Researchの取得証拠と引用検証済み統合結果から作成'
      : 'Created from retrieved Grounded Research evidence and citation-validated synthesis',
  }];

  slides.push(...sections.slice(0, MAX_SLIDES - 2));

  const citations = extractCitationLinks(input.synthesis);
  if (citations.length > 0 && slides.length < MAX_SLIDES) {
    slides.push({
      title: input.language === 'ja' ? '出典' : 'Sources',
      content: citations.map((citation) => `[${citation.label}] ${citation.url}`).join('\n'),
    });
  }
  return slides.slice(0, MAX_SLIDES);
}

function presentationRequest(input: BuildInput, title: string): ArtifactRequest {
  return { type: 'pptx', title, slides: presentationSlides(input, title) };
}

function parseMarkdownTable(text: string): Array<Array<string>> | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const split = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) =>
    cell.trim().replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '$1 ($2)'));

  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index].includes('|') || !lines[index + 1].includes('|')) continue;
    const header = split(lines[index]);
    const separator = split(lines[index + 1]);
    const separatorValid = separator.length === header.length
      && separator.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
    if (!separatorValid || header.length < 2) continue;

    const rows: Array<Array<string>> = [header];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex].includes('|')) break;
      const row = split(lines[rowIndex]);
      if (row.length !== header.length) break;
      rows.push(row);
      if (rows.length >= 1000) break;
    }
    return rows.length >= 2 ? rows : null;
  }
  return null;
}

function spreadsheetRequest(input: BuildInput, title: string): ArtifactRequest | null {
  const rows = parseMarkdownTable(input.synthesis);
  return rows ? { type: 'xlsx', title, rows } : null;
}

export function buildResearchArtifactSupervisorV1(input: BuildInput): ResearchArtifactSupervisorResultV1 {
  const outputs = supportedOutputs(input.requestedOutputs);
  if (outputs.length === 0) return { ok: false, code: 'RESEARCH_ARTIFACT_NOT_REQUESTED' };
  if (outputs.length > 1) return { ok: false, code: 'RESEARCH_ARTIFACT_MULTIPLE_OUTPUTS_UNSUPPORTED' };

  const output = outputs[0];
  const title = titleFromQuery(input.query, input.language);
  const request = output === 'document'
    ? documentRequest(input, title)
    : output === 'presentation'
      ? presentationRequest(input, title)
      : spreadsheetRequest(input, title);

  if (!request) return { ok: false, code: 'RESEARCH_ARTIFACT_TABLE_REQUIRED' };

  try {
    const generated = generateArtifactV12(request);
    if (!generated.verified) return { ok: false, code: 'RESEARCH_ARTIFACT_GENERATION_FAILED' };
    if (generated.bytes.length > MAX_INLINE_ARTIFACT_BYTES) return { ok: false, code: 'RESEARCH_ARTIFACT_TOO_LARGE' };
    return {
      ok: true,
      artifact: {
        version: RESEARCH_ARTIFACT_SUPERVISOR_VERSION_V1,
        output,
        format: generated.type as ResearchSupervisorArtifactV1['format'],
        filename: generated.filename,
        mimeType: generated.mimeType,
        bytesBase64: generated.bytes.toString('base64'),
        bytes: generated.bytes.length,
        sha256: generated.sha256,
        verified: true,
        verification: generated.verification,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
        provenance: {
          derivedFrom: 'grounded-research-synthesis',
          citationValidated: true,
          sourceCount: Math.max(0, Math.floor(input.sourceCount)),
        },
      },
    };
  } catch {
    return { ok: false, code: 'RESEARCH_ARTIFACT_GENERATION_FAILED' };
  }
}
