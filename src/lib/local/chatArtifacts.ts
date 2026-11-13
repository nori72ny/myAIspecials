/**
 * チャット完了イベントに同梱されるファイル成果物（docx / pptx / xlsx）の
 * クライアント側検証とダウンロード（PR-3a クライアント接続）。
 *
 * 検証条件は UnifiedChatCore の parseOriginArtifacts /
 * decodeArtifactPackage / downloadArtifact と同一の契約を写し取ったもの。
 * UnifiedChatCore は到達不能コード（別PRで削除予定）のため import はせず、
 * この独立モジュールに実装する。
 *
 * 契約の要点:
 * - 形式検証（id 形式・kind・mime・sha256 形式・byteLength 上限・
 *   verification 配列・freeOnly / costUsd 0 / paidFallbackUsed false）
 * - base64 を再デコードし、ZIP 署名とパッケージマーカー
 *   （word/document.xml 等）の実在を確認する
 * - ダウンロード前に SHA-256 を再計算して申告値と照合する
 * - 検証に失敗した成果物は黙って除外する（画面にエラーは出さない）
 * - 費用は常に $0（freeOnly でない成果物は受け付けない）
 */

export type ChatFileArtifactType = 'docx' | 'pptx' | 'xlsx';

export type ChatFileArtifact = {
  id: string;
  kind: 'document' | 'presentation' | 'spreadsheet';
  artifactType: ChatFileArtifactType;
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

const CHAT_FILE_FORMAT_RULES = {
  docx: {
    kind: 'document',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    packageMarker: 'word/document.xml',
  },
  pptx: {
    kind: 'presentation',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    packageMarker: 'ppt/presentation.xml',
  },
  xlsx: {
    kind: 'spreadsheet',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    packageMarker: 'xl/workbook.xml',
  },
} as const;

/** base64 を復号し、ZIP 署名とパッケージマーカーを確認する。 */
export function decodeChatFileArtifactBytes(
  artifact: Pick<ChatFileArtifact, 'artifactType' | 'byteLength' | 'data'>,
): Uint8Array | null {
  let binary = '';
  try {
    binary = globalThis.atob(artifact.data);
  } catch {
    return null;
  }
  if (binary.length !== artifact.byteLength || binary.length < 4) return null;
  if (binary.charCodeAt(0) !== 0x50 || binary.charCodeAt(1) !== 0x4b || binary.charCodeAt(2) !== 0x03 || binary.charCodeAt(3) !== 0x04) return null;
  const rule = CHAT_FILE_FORMAT_RULES[artifact.artifactType];
  if (!binary.includes(rule.packageMarker)) return null;
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validateChatFileArtifact(item: unknown): ChatFileArtifact | null {
  if (!item || typeof item !== 'object') return null;
  const artifact = item as Partial<ChatFileArtifact>;
  if (artifact.artifactType !== 'docx' && artifact.artifactType !== 'pptx' && artifact.artifactType !== 'xlsx') return null;
  const rule = CHAT_FILE_FORMAT_RULES[artifact.artifactType];
  if (
    typeof artifact.id !== 'string'
    || !/^artifact-(?:docx|pptx|xlsx)-[a-f0-9]{20}$/.test(artifact.id)
    || artifact.kind !== rule.kind
    || typeof artifact.filename !== 'string'
    || artifact.filename.length === 0
    || artifact.filename.length > 240
    || /[\\/\0]/.test(artifact.filename)
    || !artifact.filename.toLowerCase().endsWith('.' + artifact.artifactType)
    || artifact.mimeType !== rule.mimeType
    || typeof artifact.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(artifact.sha256)
    || !Number.isInteger(artifact.byteLength)
    || (artifact.byteLength ?? 0) <= 0
    || (artifact.byteLength ?? 0) > 1_500_000
    || artifact.encoding !== 'base64'
    || typeof artifact.data !== 'string'
    || artifact.data.length === 0
    || artifact.data.length > 2_100_000
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(artifact.data)
    || artifact.verified !== true
    || !Array.isArray(artifact.verification)
    || artifact.verification.length === 0
    || artifact.verification.length > 20
    || !artifact.verification.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 240)
    || artifact.freeOnly !== true
    || artifact.costUsd !== 0
    || artifact.paidFallbackUsed !== false
  ) return null;
  if (!decodeChatFileArtifactBytes(artifact as ChatFileArtifact)) return null;
  return artifact as ChatFileArtifact;
}

/**
 * 完了イベントの artifacts を形式検証する。
 * 配列でない／4件以上はプロトコル違反として全体を落とし、
 * 個別の検証失敗はその成果物だけを黙って除外する。
 */
export function parseChatFileArtifacts(value: unknown): ChatFileArtifact[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) return [];

  const parsed: ChatFileArtifact[] = [];
  for (const item of value) {
    const artifact = validateChatFileArtifact(item);
    if (artifact) parsed.push(artifact);
  }
  return parsed;
}

/** SHA-256 を再計算し、申告されたダイジェストと一致するか確認する。 */
export async function verifyChatFileArtifactDigest(
  artifact: ChatFileArtifact,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<boolean> {
  const bytes = decodeChatFileArtifactBytes(artifact);
  if (!bytes || !subtle) return false;
  try {
    const digestBuffer = await subtle.digest('SHA-256', bytes);
    const digest = Array.from(new Uint8Array(digestBuffer))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return digest === artifact.sha256;
  } catch {
    return false;
  }
}

/**
 * 形式検証に加えて SHA-256 の実在照合まで通った成果物だけを返す。
 * 表示前の最終ゲート（チップに出すのはここを通ったものだけ）。
 */
export async function filterVerifiedChatFileArtifacts(
  value: unknown,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<ChatFileArtifact[]> {
  const parsed = parseChatFileArtifacts(value);
  const verified: ChatFileArtifact[] = [];
  for (const artifact of parsed) {
    if (await verifyChatFileArtifactDigest(artifact, subtle)) verified.push(artifact);
  }
  return verified;
}

/**
 * クリック時のダウンロード。SHA-256 を再検証してから保存を開始し、
 * 検証できない場合は何もしない（false を返す）。
 */
export async function downloadChatFileArtifact(
  artifact: ChatFileArtifact,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<boolean> {
  const bytes = decodeChatFileArtifactBytes(artifact);
  if (!bytes) return false;
  if (!(await verifyChatFileArtifactDigest(artifact, subtle))) return false;
  try {
    const url = window.URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
