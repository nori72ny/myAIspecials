/**
 * オリンパネル「AIの最新情報」の週次ダイジェスト（データファイル）。
 *
 * 拡張設計 ORIN_PANEL_EXPANSION_DESIGN_2026-11-25 §8.2・§8.4：
 * 要約は開くたびに生成せず、週次外部動向ウォッチ（水曜）と同時に
 * 人の目を通して作り、このファイルをデプロイで差し替える。
 * アプリ側は同梱データを表示するだけなので、実行時の外部通信も
 * 生成枠の消費もゼロ。
 *
 * 書き方の決まり（§8.2）：
 * - 1件＝見出し（最大2行）＋要約（2行まで・目安80〜110字）＋出典。
 * - 事実だけを書く。ORIGIN への採用判断のような開発内部の結論は
 *   混ぜない（利用者向けの情報として独立に読めること）。
 * - 出典は一次情報（公式発表・公式ブログ）を優先し、全件に
 *   リンクを付ける。リンクのない要約は出さない。
 * - 件数は3〜5件、並びは重要度順。
 * - updatedAt はダイジェストを作成した日（YYYY-MM-DD）。
 */

export interface OrinAiNewsDigestItem {
  title: { ja: string; en: string };
  summary: { ja: string; en: string };
  /** 出典の表示名（媒体・公式ブログ名）。 */
  sourceName: string;
  sourceUrl: string;
  /** 発表日（YYYY-MM-DD）。 */
  publishedAt: string;
}

export interface OrinAiNewsDigest {
  updatedAt: string;
  items: OrinAiNewsDigestItem[];
}

export const ORIN_AI_NEWS_DIGEST: OrinAiNewsDigest = {
  updatedAt: '2026-11-25',
  items: [
    {
      title: {
        ja: 'OpenAIが「GPT-6.2 Astra」と「GPT-6.2 Sol」を公開',
        en: 'OpenAI releases GPT-6.2 Astra and Sol',
      },
      summary: {
        ja: 'OpenAIが最上位モデル「GPT-6.2 Astra」と日常向け「GPT-6.2 Sol」を公開しました。長い手順の仕事や文書・コード作成の精度が上がり、AstraのAPI料金は前世代より2割安くなっています。',
        en: 'OpenAI released its new frontier model GPT-6.2 Astra and the everyday model GPT-6.2 Sol. Both handle long, multistep work and documents with fewer tokens, and Astra\u2019s API prices are 20% lower than the previous generation.',
      },
      sourceName: 'OpenAI',
      sourceUrl: 'https://openai.com/index/introducing-gpt-6-2-astra-sol/',
      publishedAt: '2026-11-17',
    },
    {
      title: {
        ja: 'Googleが「Gemini 4 Neon」を公開',
        en: 'Google introduces Gemini 4 Neon',
      },
      summary: {
        ja: 'Googleが新しいAIモデル「Gemini 4 Neon」を公開しました。大きなモデルに近い賢さを速い応答で出せる中位のモデルで、Geminiアプリや開発者向けAPIで順次使えるようになります。',
        en: 'Google introduced Gemini 4 Neon, a mid-tier model that pairs near-frontier intelligence with fast responses. It is rolling out in the Gemini app and the developer API.',
      },
      sourceName: 'Google',
      sourceUrl: 'https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-neon/',
      publishedAt: '2026-11-18',
    },
    {
      title: {
        ja: 'Anthropicが「Claude Fable 5.2」を公開',
        en: 'Anthropic releases Claude Fable 5.2',
      },
      summary: {
        ja: 'Anthropicが「Claude Fable 5.2」と「Claude Mythos 5.2」を公開しました。コード作成や推論の性能が上がり、難しい技術作業に向けた改良が加わっています。',
        en: 'Anthropic released Claude Fable 5.2 and Claude Mythos 5.2, with gains in coding, reasoning and vision for demanding technical work, at lower prices than the previous generation.',
      },
      sourceName: 'Anthropic',
      sourceUrl: 'https://www.anthropic.com/claude-fable-and-mythos-5-2',
      publishedAt: '2026-11-09',
    },
  ],
};
