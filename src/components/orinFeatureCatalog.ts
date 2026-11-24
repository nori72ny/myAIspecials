/**
 * オリンパネル「できること」タブの機能カタログ（第1段、設計
 * ORIN_PANEL_DESIGN_2026-11-24 §6）。
 *
 * 一覧の正本はこの1ファイル。画面側に状態を直書きしない。
 * 状態の決め方は項目ごとに3種（§6.3）：
 * 1. 固定：本番で常時使えるものは 'ready'、有効化待ちは
 *    'preparing'、条件つきで動くものは 'partial' をカタログに持つ。
 * 2. ヘルス連動：読み上げ（voiceOutputEnabled）と添付
 *    （attachmentsEnabled）だけは、開いた時点の確認結果で決める。
 *    取れない時は「準備中」側に倒す（fail closed：確認できない
 *    ものを「使える」とは言わない）。
 * 3. 準備中の項目には移動操作を付けない（押して「使えません」
 *    となる体験を作らない）。
 */

export type OrinFeatureStatus = 'ready' | 'partial' | 'preparing';
export type OrinFeatureAction = 'chat' | 'agent' | 'coding' | 'creative';

export interface OrinFeatureHealth {
  /** 音声読み上げが使えるか（ヘルス表示の voiceOutputEnabled）。 */
  voiceOutput: boolean;
  /** エージェントへのファイル添付が使えるか（状態表示の attachmentsEnabled）。 */
  attachments: boolean;
}

export interface OrinFeatureItem {
  id: string;
  name: { ja: string; en: string };
  description: { ja: string; en: string };
  status: OrinFeatureStatus;
  action?: OrinFeatureAction;
}

export interface OrinFeatureGroup {
  id: string;
  title: { ja: string; en: string };
  items: OrinFeatureItem[];
}

/** 状態ラベルの表示文。 */
export function orinFeatureStatusText(status: OrinFeatureStatus, ja: boolean): string {
  if (status === 'ready') return ja ? '使えます' : 'Available';
  if (status === 'partial') return ja ? '一部使えます' : 'Partly available';
  return ja ? '準備中' : 'In preparation';
}

/**
 * カタログ本体。並びは「日常で使う順」（設計 §6.2）。
 * health は開いた時点の確認結果（取れなかった項目は false）。
 */
export function buildOrinFeatureCatalog(health: OrinFeatureHealth): OrinFeatureGroup[] {
  return [
    {
      id: 'ask',
      title: { ja: '調べる・聞く', en: 'Look up & ask' },
      items: [
        {
          id: 'chat',
          name: { ja: 'チャットで質問する', en: 'Ask in chat' },
          description: {
            ja: '日常の質問・相談に、その場で答えます。',
            en: 'Everyday questions and advice, answered on the spot.',
          },
          status: 'ready',
          action: 'chat',
        },
        {
          id: 'research',
          name: { ja: '詳しく調べる', en: 'Research in depth' },
          description: {
            ja: '出典つきで、複数の情報源を確かめて調べます。',
            en: 'Checks multiple sources and answers with citations.',
          },
          status: 'ready',
          action: 'chat',
        },
        {
          id: 'fresh',
          name: { ja: '最新情報を確認する', en: 'Check the latest' },
          description: {
            ja: 'ニュース・天気・相場など、新しい情報を確認します。',
            en: 'News, weather, markets and other fresh information.',
          },
          status: 'ready',
          action: 'chat',
        },
      ],
    },
    {
      id: 'delegate',
      title: { ja: '作業を任せる', en: 'Delegate work' },
      items: [
        {
          id: 'agent',
          name: { ja: 'エージェントに任せる', en: 'Delegate to the agent' },
          description: health.attachments
            ? {
              ja: '調べる・まとめる・文書にする作業を任せられます。ファイルの添付もできます。',
              en: 'Research, summarising and document work. You can attach files, too.',
            }
            : {
              ja: '調べる・まとめる・文書にする作業を任せられます。ファイルの添付は準備中です。',
              en: 'Research, summarising and document work. File attachments are in preparation.',
            },
          status: 'ready',
          action: 'agent',
        },
      ],
    },
    {
      id: 'create',
      title: { ja: '作る', en: 'Create' },
      items: [
        {
          id: 'coding',
          name: { ja: 'コードを書く・直す', en: 'Write or fix code' },
          description: {
            ja: 'プログラムの作成と説明ができます。',
            en: 'Creates programs and explains them.',
          },
          status: 'ready',
          action: 'coding',
        },
        {
          id: 'image',
          name: { ja: '画像を作る', en: 'Create images' },
          description: {
            ja: 'イラスト・画像の生成ができます。編集・別案・動画化もできます。',
            en: 'Generates illustrations and images, with editing, variations and animation.',
          },
          status: 'ready',
          action: 'creative',
        },
        {
          id: 'documents',
          name: { ja: '資料を作る', en: 'Make documents' },
          description: {
            ja: '企画・構成の相談はチャットで使えます。文書の自動生成は有効化待ちです。',
            en: 'Planning and structure advice works in chat. Automatic document generation is awaiting activation.',
          },
          status: 'partial',
          action: 'chat',
        },
      ],
    },
    {
      id: 'voice',
      title: { ja: '声', en: 'Voice' },
      items: [
        {
          id: 'read-aloud',
          name: { ja: '回答を読み上げる', en: 'Read answers aloud' },
          description: health.voiceOutput
            ? {
              ja: '回答を声で読み上げます。',
              en: 'Reads answers aloud.',
            }
            : {
              ja: '本番ではまだ有効になっていません。',
              en: 'Not yet enabled in production.',
            },
          status: health.voiceOutput ? 'ready' : 'preparing',
        },
        {
          id: 'voice-talk',
          name: { ja: '声で話しかける・会話する', en: 'Talk by voice' },
          description: {
            ja: '日本語の聞き取り確認のあとに使えるようになります。',
            en: 'Available after the Japanese listening check.',
          },
          status: 'preparing',
        },
      ],
    },
    {
      id: 'connect',
      title: { ja: 'つなぐ', en: 'Connect' },
      items: [
        {
          id: 'external',
          name: { ja: '外部のサービスとつなぐ', en: 'Connect outside services' },
          description: {
            ja: 'メール・予定表などとの連携は、土台の準備までで本番ではまだ動いていません。',
            en: 'Mail and calendar links are prepared but not live yet.',
          },
          status: 'preparing',
        },
      ],
    },
  ];
}
