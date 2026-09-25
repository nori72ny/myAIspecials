export interface OriginCapabilityGuide {
  language: "ja" | "en";
  content: string;
  limitations: readonly string[];
  nextActions: readonly string[];
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

function japaneseGuide(): OriginCapabilityGuide {
  const content = `ORIGINは、質問に答えるだけでなく、調査・作成物生成・Web制作・Codingまでを、現在の公開版で実行できる範囲は実際に実行するAIエージェントです。

現在できること
- 会話・分析：相談、比較、意思決定支援、文章、営業台本、メール、SNS投稿、企画を作成
- Grounded Research：無料の公開Web情報を検索し、取得できた根拠に基づいて調査結果をまとめる
- 実ファイル生成：Markdown、CSV、PDF、DOCX、XLSX、PPTXを生成し、検証済みダウンロードとして返す
- Web / App Builder：Landing Page、Dashboard、Web Appの静的プロジェクトZIPを生成・検証する
- Web公開：認証・保存基盤が利用可能な環境では、確認付きで期限付き静的サイトとして公開できる
- Agentic Coding：ORIGIN自身の固定Coding対象に対して、認証・暗号化・永続化されたCoding jobを実行し、結果を取得できる
- Creative：Social Card、Poster、Info Cardを検証済みSVGとして生成・保存できる

安全上の境界
ORIGINは、実行記録がない処理を「実行済み」と表示しません。無料経路だけを利用し、有料fallbackは行いません。外部情報、外部サービス、Coding実行などが利用できない場合は、推測で成功扱いせずfail-closedします。

現在まだできないこと
- モデルによるラスター画像生成や画像編集
- Coding結果をGitへ自動公開したり、そのまま自動Deployすること
- MCP経由のGitHub、Google、Microsoft、Notion、Slack等の外部サービス接続
- 未承認の外部送信や、証拠のない自動実行

頼み方は決まっていません。「最新情報を調べて」「PDFを作って」「LPを作ってZIPで出して」「このコードを直す方針を出して」「SNS用カードを作って」のように、そのまま依頼してください。ORIGINは実行できる経路と、まだ実行できない境界を区別して返します。`;

  return {
    language: "ja",
    content,
    limitations: [
      "モデルベースのラスター画像生成・画像編集、Coding結果のGit自動公開/自動Deploy、MCP経由の外部アプリ接続は現在の公開版では未接続です。",
      "Web調査や外部実行は無料・安全条件を満たさない場合にfail-closedし、未確認の結果を生成しません。",
    ],
    nextActions: [
      "作りたいもの、調べたいこと、直したいものをそのまま一文で入力してください。実行できる機能は実行し、未接続部分だけを明示します。",
    ],
  };
}

function englishGuide(): OriginCapabilityGuide {
  const content = `ORIGIN is an AI agent that can execute research, artifact generation, web building, and coding workflows that are connected in the current public release—not just describe them.

What it can do now
- Conversation and analysis: planning, comparison, decision support, writing, sales scripts, email, social content, and product thinking
- Grounded Research: search free public-web sources and summarize only retrieved evidence
- Real artifact generation: create verified Markdown, CSV, PDF, DOCX, XLSX, and PPTX downloads
- Web / App Builder: generate and verify static Landing Page, Dashboard, and Web App project ZIPs
- Web publication: in an authenticated configured environment, publish verified static projects as expiring sites after confirmation
- Agentic Coding: run durable authenticated coding jobs against ORIGIN's fixed server-owned coding target and retrieve persisted results
- Creative: generate verified static SVG social cards, posters, and info cards

Safety boundary
ORIGIN does not claim an operation was executed without execution evidence. It remains free-only, has no paid fallback, and fails closed when a required external source or execution path cannot be verified.

Not connected yet
- Model-based raster image generation or image editing
- Automatic Git publication or automatic deployment of coding results
- MCP connections to external services such as GitHub, Google, Microsoft, Notion, or Slack
- Unapproved external writes or unsupported autonomous actions

You can ask naturally: “research the latest information,” “make a PDF,” “build a landing page and give me the ZIP,” “help fix this code,” or “make a social card.” ORIGIN will distinguish what it actually executed from what remains unavailable.`;

  return {
    language: "en",
    content,
    limitations: [
      "Model-based raster image generation/editing, automatic Git/deployment from coding jobs, and MCP-based external app connections are not connected in the current public release.",
      "External research or execution fails closed when the free and safety requirements cannot be verified.",
    ],
    nextActions: [
      "Describe what you want to research, create, or fix in one sentence. ORIGIN will execute connected capabilities and clearly label unavailable steps.",
    ],
  };
}

export function createOriginCapabilityGuide(input: string): OriginCapabilityGuide {
  return /[ぁ-んァ-ヶ一-龠]/.test(input) ? japaneseGuide() : englishGuide();
}
