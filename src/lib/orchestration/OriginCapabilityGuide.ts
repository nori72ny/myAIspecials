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
  const content = `ORIGINは、質問に答えるだけでなく、目的を整理し、今の版で実行できる範囲の成果物まで作るAIエージェントです。

現在できること
- 資料・提案書：目的、相手、利用場面に合わせて構成から本文まで作成
- スライド：全体構成、各ページの見出し・本文・図解案・発表原稿を作成
- 文章・トーク：営業台本、メール、SNS・Instagram投稿、記事、説明文を用途別に作成
- 比較・分析：貼り付けられた情報やデータを整理し、比較表、判断基準、推奨案、注意点を提示
- 画像・Web・アプリ：画像指示、画面設計、仕様、導線、コピー、コードなど、制作に必要な内容を設計・作成
- 思考と実行支援：曖昧な相談から本当の目的を整理し、必要な情報、優先順位、次の行動まで提案

ORIGINが目指す対応
依頼文をそのまま処理するだけでなく、成果を良くするために不足している観点やデータ、リスク、より適した成果物を先回りして補います。専門AIや外部サービスが接続された仕事は、実際に利用した記録がある場合だけ「実行済み」と表示します。

今の版では、テキスト回答内の成果物作成と、提供された情報の整理・分析が中心です。リアルタイム検索、画像ファイル生成、スライドファイル生成、アプリやWebサイトの公開はまだ接続されていません。ただし、未接続の処理を完了したようには見せず、その時点で作れる最も実用的な下書き・仕様・コード・実行手順まで返します。

頼み方は決まっていません。「新商品の提案書を作りたい」「このメモからInstagram投稿を5本作って」「比較して最適案を決めて」「アプリのアイデアを形にして」のように、やりたいことをそのまま入力してください。`;

  return {
    language: "ja",
    content,
    limitations: [
      "リアルタイム検索と、画像・文書・スライド・アプリ・Webサイトの実ファイル生成または公開は、現在の公開版では未接続です。",
    ],
    nextActions: [
      "作りたいもの、解決したいこと、または迷っていることを一文で入力してください。不足情報はORIGINが必要な分だけ確認します。",
    ],
  };
}

function englishGuide(): OriginCapabilityGuide {
  const content = `ORIGIN is an AI agent that goes beyond answering questions: it clarifies the goal and produces the most useful result currently possible.

What it can do now
- Draft documents and proposals from structure through final copy
- Design slide narratives, page content, visual directions, and speaker notes
- Create sales scripts, emails, social posts, articles, and explanations
- Organize supplied information into comparisons, decision criteria, recommendations, and risks
- Design image briefs, websites, apps, user flows, specifications, copy, and code
- Turn an unclear request into a goal, required information, priorities, and next actions

ORIGIN is designed to add the information, data needs, risks, and output formats that materially improve the result. It only claims that a specialist AI or external service was used when an execution record proves it.

The current release focuses on text deliverables and analysis of information you provide. Live search, generated image files, presentation files, and app or website publishing are not connected yet. ORIGIN will never present those unexecuted steps as completed; it will instead provide the best usable draft, specification, code, or execution plan available.

There is no fixed request format. Describe what you want in your own words, such as “create a product proposal,” “turn these notes into five Instagram posts,” “compare these options and recommend one,” or “shape my app idea into a build plan.”`;

  return {
    language: "en",
    content,
    limitations: [
      "Live search and actual image, document, slide, app, or website generation and publishing are not connected in the current public release.",
    ],
    nextActions: [
      "Describe what you want to create, solve, or decide in one sentence. ORIGIN will ask only for information that materially affects the result.",
    ],
  };
}

export function createOriginCapabilityGuide(input: string): OriginCapabilityGuide {
  return /[ぁ-んァ-ヶ一-龠]/.test(input) ? japaneseGuide() : englishGuide();
}
