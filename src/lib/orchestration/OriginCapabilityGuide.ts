export interface OriginCapabilityGuide {
  language: "ja" | "en";
  content: string;
  limitations: readonly string[];
  nextActions: readonly string[];
}

export interface OriginCapabilityStatus {
  rasterTextToImageReady?: boolean;
  rasterImageEditingReady?: boolean;
}

const CAPABILITY_QUESTION_PATTERNS = [
  /(?:あなた|ORIGIN|このAI|このサービス).{0,12}(?:何|なに).{0,8}(?:でき|可能)/i,
  /(?:何|なに).{0,8}(?:できる|できますか|してくれる)/i,
  /(?:機能|対応範囲|できること).{0,8}(?:教えて|知りたい|一覧)/i,
  /\bwhat can (?:you|origin) do\b/i,
  /\b(?:your|origin'?s) (?:capabilities|features)\b/i,
] as const;

export function isOriginCapabilityQuestion(input: string): boolean {
  const normalized = input.trim();
  if (normalized.length === 0 || normalized.length > 240) return false;
  if (/(?:作成|制作|生成|実装|開発|完成|修正|分析|比較|整理).{0,16}(?:して|してください|してほしい)|(?:作って|書いて|直して|調べて|比較して)/i.test(normalized)) {
    return false;
  }
  return CAPABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function japaneseGuide(status: OriginCapabilityStatus): OriginCapabilityGuide {
  const rasterCapability = status.rasterTextToImageReady
    ? "- 実画像生成：検証済みの無料画像生成経路で、プロンプトからPNG/JPEG/WebPのラスター画像を生成し、寸法・画像形式・品質ゲートを通過した画像だけを返す\n"
    : "";
  const rasterEditingCapability = status.rasterImageEditingReady
    ? "- 実画像編集：検証済みの元画像をローカル参照として使い、既存画像の別案作成と指示ベース編集を無料のモデル経路で実行し、品質ゲートを通過した画像だけを返す\n"
    : "";
  const rasterLimitations = [
    ...(!status.rasterTextToImageReady ? ["モデルによるラスター画像生成"] : []),
    ...(!status.rasterImageEditingReady ? ["モデルによる参照画像編集（別案・指示ベース編集）"] : []),
    "マスク領域を直接指定するinpaintと、キャンバスを拡張するoutpaint",
  ];

  const content = `ORIGINは、質問に答えるだけでなく、調査・成果物生成・Web制作・Codingまでを、現在の公開版で実行できる範囲は実際に実行するAIエージェントです。

現在できること
- 会話・分析：相談、比較、意思決定支援、文章、営業台本、メール、SNS投稿、企画を作成
- Grounded Research：無料の公開Web情報を検索し、取得できた根拠に基づいて調査結果をまとめる
- 実ファイル生成：Markdown、CSV、PDF、DOCX、XLSX、PPTXを生成し、検証済みダウンロードとして返す。PDFは現時点では英数字中心の内容のみ対応し、日本語など非ASCII文字は文字化けを防ぐため安全停止する
- Web / App Builder：Landing Page、Dashboard、Web Appの静的プロジェクトZIPを生成・検証する
- Web公開：認証・保存基盤が利用可能な環境では、確認付きで期限付き静的サイトとして公開できる
- Agentic Coding：ORIGIN自身の固定Coding対象に対して、認証・暗号化・永続化されたCoding jobを実行し、結果を取得できる
- Creative：Social Card、Poster、Info Cardを検証済みSVGとして生成・保存できる
${rasterCapability}${rasterEditingCapability}
安全上の境界
ORIGINは、実行記録がない処理を「実行済み」と表示しません。無料経路だけを利用し、有料fallbackは行いません。外部情報、外部サービス、Coding実行などが利用できない場合は、推測で成功扱いせずfail-closedします。

現在まだできないこと
${rasterLimitations.map((item) => `- ${item}`).join("\n")}
- Coding結果をGitへ自動公開したり、そのまま自動Deployすること
- MCP経由のGitHub、Google、Microsoft、Notion、Slack等の外部サービス接続
- 未承認の外部送信や、証拠のない自動実行

頼み方は決まっていません。「最新情報を調べて」「PDFを作って」「LPを作ってZIPで出して」「このコードを直す方針を出して」「SNS用カードを作って」のように、そのまま依頼してください。ORIGINは実行できる経路と、まだ実行できない境界を区別して返します。`;

  return {
    language: "ja",
    content,
    limitations: [
      [...rasterLimitations, "Coding結果のGit自動公開/自動Deploy", "MCP経由の外部アプリ接続"].join("、") + "は現在の公開版では未接続です。",
      "Web調査や外部実行は無料・安全条件を満たさない場合にfail-closedし、未確認の結果を生成しません。",
    ],
    nextActions: [
      "作りたいもの、調べたいこと、直したいものをそのまま一文で入力してください。実行できる機能は実行し、未接続部分だけを明示します。",
    ],
  };
}

function englishGuide(status: OriginCapabilityStatus): OriginCapabilityGuide {
  const rasterCapability = status.rasterTextToImageReady
    ? "- Real image generation: use the verified free image route to create PNG/JPEG/WebP raster images from prompts and return only images that pass format, dimension, and quality gates\n"
    : "";
  const rasterEditingCapability = status.rasterImageEditingReady
    ? "- Real image editing: use a verified local source image as the bounded reference for free model-based variations and instruction-guided edits, returning only images that pass quality gates\n"
    : "";
  const rasterLimitations = [
    ...(!status.rasterTextToImageReady ? ["Model-based raster image generation"] : []),
    ...(!status.rasterImageEditingReady ? ["Reference-image editing (variations and instruction-guided edits)"] : []),
    "Mask-directed inpainting and canvas-expansion outpainting",
  ];

  const content = `ORIGIN is an AI agent that can execute research, artifact generation, web building, and coding workflows that are connected in the current public release—not just describe them.

What it can do now
- Conversation and analysis: planning, comparison, decision support, writing, sales scripts, email, social content, and product thinking
- Grounded Research: search free public-web sources and summarize only retrieved evidence
- Real artifact generation: create verified Markdown, CSV, PDF, DOCX, XLSX, and PPTX downloads. PDF is currently limited to ASCII text until a verified embedded-Unicode renderer is available; unsupported text fails closed
- Web / App Builder: generate and verify static Landing Page, Dashboard, and Web App project ZIPs
- Web publication: in an authenticated configured environment, publish verified static projects as expiring sites after confirmation
- Agentic Coding: run durable authenticated coding jobs against ORIGIN's fixed server-owned coding target and retrieve persisted results
- Creative: generate verified static SVG social cards, posters, and info cards
${rasterCapability}${rasterEditingCapability}
Safety boundary
ORIGIN does not claim an operation was executed without execution evidence. It remains free-only, has no paid fallback, and fails closed when a required external source or execution path cannot be verified.

Not connected yet
${rasterLimitations.map((item) => `- ${item}`).join("\n")}
- Automatic Git publication or automatic deployment of coding results
- MCP connections to external services such as GitHub, Google, Microsoft, Notion, or Slack
- Unapproved external writes or unsupported autonomous actions

You can ask naturally: “research the latest information,” “make a PDF,” “build a landing page and give me the ZIP,” “help fix this code,” or “make a social card.” ORIGIN will distinguish what it actually executed from what remains unavailable.`;

  return {
    language: "en",
    content,
    limitations: [
      [...rasterLimitations, "automatic Git/deployment from coding jobs", "MCP-based external app connections"].join(", ") + " are not connected in the current public release.",
      "External research or execution fails closed when the free and safety requirements cannot be verified.",
    ],
    nextActions: [
      "Describe what you want to research, create, or fix in one sentence. ORIGIN will execute connected capabilities and clearly label unavailable steps.",
    ],
  };
}

export function createOriginCapabilityGuide(
  input: string,
  status: OriginCapabilityStatus = {},
): OriginCapabilityGuide {
  return /[ぁ-んァ-ヶ一-龠]/.test(input) ? japaneseGuide(status) : englishGuide(status);
}
