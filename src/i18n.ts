export type OriginLanguage = 'ja' | 'en';

type StarterCard = {
  title: string;
  subtitle: string;
  description: string;
  prompt: string;
};

type Translation = {
  code: string;
  preview: string;
  copy: string;
  copied: string;
  download: string;
  fullscreen: string;
  exitFullscreen: string;
  close: string;
  closeWorkspace: string;
  showCode: string;
  showPreview: string;
  copyArtifact: string;
  downloadArtifact: string;
  openFullscreen: string;
  exitFullscreenLabel: string;
  openSettings: string;
  closeSettings: string;
  settings: string;
  settingsDescription: string;
  newConversation: string;
  newConversationLabel: string;
  start: string;
  startRequest: string;
  send: string;
  sendRequest: string;
  stop: string;
  stopGeneration: string;
  attach: string;
  attachFile: string;
  attachedFiles: string;
  dropFiles: string;
  removeAttachment: string;
  attachmentTooLarge: string;
  attachmentTotalTooLarge: string;
  unsupportedAttachment: string;
  attachmentReadError: string;
  chatPlaceholder: string;
  homePlaceholder: string;
  workspaceLabel: string;
  displayMode: string;
  previewTitle: string;
  userRequest: string;
  assistantResponse: string;
  conversationLog: string;
  thinking: string;
  responseReady: string;
  error: string;
  keyboardGuidance: string;
  homeHeading: string;
  homeDescription: string;
  startWith: string;
  freeOnlyNotice: string;
  starterCards: readonly StarterCard[];
  languageHeading: string;
  languageJapanese: string;
  languageEnglish: string;
  appearanceHeading: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
  systemThemeDescription: string;
  historyHeading: string;
  historyCount: (count: number) => string;
  historyFileLabel: string;
  exportHistory: string;
  importHistory: string;
  clearHistory: string;
  portableHistoryNotice: string;
  historyImported: string;
  historyCleared: string;
  historyImportUnavailable: string;
  historyImportFailed: string;
  safetyHeading: string;
  freeOnlyTitle: string;
  freeOnlyDescription: string;
  secretWarning: string;
  technicalInformation: string;
  releaseId: string;
  releaseChecking: string;
  releaseUnavailable: string;
  showFullReleaseId: string;
  shortenReleaseId: string;
  copyReleaseId: string;
  releaseIdCopyFailed: string;
  releaseIdHelp: string;
  pwaUpdateNotice: string;
};

export const TRANSLATIONS: Record<OriginLanguage, Translation> = {
  ja: {
    code: 'コード',
    preview: 'プレビュー',
    copy: 'コピー',
    copied: 'コピー済み',
    download: 'ダウンロード',
    fullscreen: '全画面',
    exitFullscreen: '縮小',
    close: '閉じる',
    closeWorkspace: '成果物ワークスペースを閉じる',
    showCode: 'コードを表示',
    showPreview: 'プレビューを表示',
    copyArtifact: '成果物をコピー',
    downloadArtifact: '成果物をダウンロード',
    openFullscreen: '全画面で表示',
    exitFullscreenLabel: '全画面表示を終了',
    openSettings: '設定を開く',
    closeSettings: '設定を閉じる',
    settings: '設定',
    settingsDescription: '変更は自動で保存されます。',
    newConversation: '新規対話',
    newConversationLabel: '新規対話を開始',
    start: '始める →',
    startRequest: '依頼を開始',
    send: '送信',
    sendRequest: '依頼を送信',
    stop: '停止',
    stopGeneration: '生成を停止',
    attach: '添付',
    attachFile: 'ファイルを添付',
    attachedFiles: '添付ファイル',
    dropFiles: '画像またはテキストファイルをここにドロップ',
    removeAttachment: '添付を削除',
    attachmentTooLarge: 'ファイルは5MB以下にしてください。',
    attachmentTotalTooLarge: '添付ファイルの合計は10MB以下にしてください。',
    unsupportedAttachment: '画像またはテキストファイルを選択してください。',
    attachmentReadError: 'ファイルを読み込めませんでした。',
    chatPlaceholder: 'ORIGIN に指示を入力... (⌘+Enter で送信)',
    homePlaceholder: '実現したいこと、迷っていること、途中のメモをそのまま入力',
    workspaceLabel: '成果物プレビューワークスペース',
    displayMode: '表示モード',
    previewTitle: 'プレビュー',
    userRequest: 'あなたの依頼',
    assistantResponse: 'ORIGINの回答',
    conversationLog: '会話履歴',
    thinking: 'ORIGIN が思考・生成中…',
    responseReady: 'ORIGINの回答が届きました',
    error: 'エラーが発生しました。再度お試しください。',
    keyboardGuidance: 'ControlまたはCommandとEnterで送信できます。パスワードやAPIキーは入力しないでください。',
    homeHeading: '何を実現したいですか？',
    homeDescription: '考えがまとまっていなくても構いません。目的と条件を一緒に整理し、次の一歩が見える形に整えます。',
    startWith: '始め方を選ぶ',
    freeOnlyNotice: '現在は無料AIのみを使用し、有料AIへ自動で切り替えません。',
    starterCards: [
      { title: '整理する', subtitle: '即時ロジック設計', description: '断片的な考えから、次の一歩を明確にする', prompt: '以下の内容を整理し、結論先行で構造化してください:\n' },
      { title: '比較する', subtitle: 'ディープリサーチ', description: '候補の違いと判断基準を見える形にする', prompt: '以下の候補について多角的な基準で比較分析してください:\n' },
      { title: '文章にする', subtitle: 'セキュア成果物', description: 'メモを、伝わる文章・コードへ整える', prompt: '以下の内容を洗練された文章とWeb成果物に整えてください:\n' },
      { title: '計画する', subtitle: 'データ構造化', description: '目的から、実行できる順序を組み立てる', prompt: '以下の目的を達成するための具体的実行計画を立ててください:\n' },
    ],
    languageHeading: '表示言語',
    languageJapanese: '日本語',
    languageEnglish: 'English',
    appearanceHeading: '画面の明るさ',
    themeLight: '明るい',
    themeDark: '暗い',
    themeSystem: 'システム設定',
    systemThemeDescription: 'システム設定では端末の明るさに即時追従し、すべての画面要素を同じテーマで表示します。',
    historyHeading: '会話履歴',
    historyCount: (count) => `このブラウザーの会話は現在 ${count} 件です。`,
    historyFileLabel: '会話履歴ファイルを選択',
    exportHistory: '書き出す',
    importHistory: '読み込む',
    clearHistory: '初期化',
    portableHistoryNotice: '書き出しは持ち運び可能なJSON形式です。読み込み前に内容を検証します。',
    historyImported: '会話履歴をインポートしました。',
    historyCleared: '会話履歴を初期化しました。',
    historyImportUnavailable: '会話履歴の読み込みはこの画面では利用できません。',
    historyImportFailed: 'ファイルをインポートできませんでした。',
    safetyHeading: '安全と費用',
    freeOnlyTitle: 'この版は無料AIだけを使います。',
    freeOnlyDescription: '$0.00上限・無料モデル固定・自動切替なし。',
    secretWarning: 'パスワード、APIキー、トークン、秘密鍵を設定画面やチャットへ入力しないでください。',
    technicalInformation: '技術情報',
    releaseId: 'リリースID',
    releaseChecking: '確認中…',
    releaseUnavailable: '確認できません',
    showFullReleaseId: '全文を表示',
    shortenReleaseId: '短く表示',
    copyReleaseId: 'リリースIDをコピー',
    releaseIdCopyFailed: 'リリースIDをコピーできませんでした。',
    releaseIdHelp: '現在動いている版を確認するときに使用します。',
    pwaUpdateNotice: '最新版を次回の起動時に安全に適用します。現在の入力内容はそのまま保持されます。',
  },
  en: {
    code: 'Code',
    preview: 'Preview',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    close: 'Close',
    closeWorkspace: 'Close artifact workspace',
    showCode: 'Show code',
    showPreview: 'Show preview',
    copyArtifact: 'Copy artifact',
    downloadArtifact: 'Download artifact',
    openFullscreen: 'View fullscreen',
    exitFullscreenLabel: 'Exit fullscreen',
    openSettings: 'Open settings',
    closeSettings: 'Close settings',
    settings: 'Settings',
    settingsDescription: 'Changes are saved automatically.',
    newConversation: 'New conversation',
    newConversationLabel: 'Start a new conversation',
    start: 'Start →',
    startRequest: 'Start request',
    send: 'Send',
    sendRequest: 'Send request',
    stop: 'Stop',
    stopGeneration: 'Stop generating',
    attach: 'Attach',
    attachFile: 'Attach a file',
    attachedFiles: 'Attached files',
    dropFiles: 'Drop image or text files here',
    removeAttachment: 'Remove attachment',
    attachmentTooLarge: 'Each file must be 5MB or smaller.',
    attachmentTotalTooLarge: 'The combined attachment size must be 10MB or smaller.',
    unsupportedAttachment: 'Choose an image or text file.',
    attachmentReadError: 'This file could not be read.',
    chatPlaceholder: 'Tell ORIGIN what you need… (⌘+Enter to send)',
    homePlaceholder: 'Write your goal, question, or unfinished notes',
    workspaceLabel: 'Artifact preview workspace',
    displayMode: 'Display mode',
    previewTitle: 'Preview',
    userRequest: 'Your request',
    assistantResponse: 'ORIGIN response',
    conversationLog: 'Conversation history',
    thinking: 'ORIGIN is thinking…',
    responseReady: 'ORIGIN response is ready',
    error: 'Something went wrong. Please try again.',
    keyboardGuidance: 'Press Control or Command with Enter to send. Do not enter passwords or API keys.',
    homeHeading: 'What would you like to accomplish?',
    homeDescription: 'You do not need a finished thought. We will clarify your objective and constraints into an actionable next step.',
    startWith: 'Choose a starting point',
    freeOnlyNotice: 'This release uses free AI only and never switches to paid AI automatically.',
    starterCards: [
      { title: 'Organize', subtitle: 'Rapid logic design', description: 'Turn fragmented thoughts into a clear next step', prompt: 'Organize the following content and present a conclusion-first structure:\n' },
      { title: 'Compare', subtitle: 'Deep research', description: 'Make differences and decision criteria visible', prompt: 'Compare the following options using multiple decision criteria:\n' },
      { title: 'Write', subtitle: 'Secure artifact', description: 'Turn notes into clear writing or code', prompt: 'Refine the following content into polished writing and a web artifact:\n' },
      { title: 'Plan', subtitle: 'Structured data', description: 'Build an executable sequence from the objective', prompt: 'Create a concrete execution plan to achieve the following objective:\n' },
    ],
    languageHeading: 'Language',
    languageJapanese: 'Japanese',
    languageEnglish: 'English',
    appearanceHeading: 'Appearance',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    systemThemeDescription: 'System mode follows your device setting immediately and keeps every surface in sync.',
    historyHeading: 'Conversation history',
    historyCount: (count) => `${count} messages are currently held in this browser tab.`,
    historyFileLabel: 'Choose conversation history file',
    exportHistory: 'Export',
    importHistory: 'Import',
    clearHistory: 'Clear',
    portableHistoryNotice: 'Export uses a portable JSON file. Imported files are checked before use.',
    historyImported: 'Conversation history was imported.',
    historyCleared: 'Conversation history was cleared.',
    historyImportUnavailable: 'History import is unavailable in this view.',
    historyImportFailed: 'Could not import this file.',
    safetyHeading: 'Safety and cost',
    freeOnlyTitle: 'This release uses free AI only.',
    freeOnlyDescription: '$0.00 maximum · fixed free model · no automatic switching.',
    secretWarning: 'Do not enter passwords, API keys, tokens, or private keys here or in chat.',
    technicalInformation: 'Technical information',
    releaseId: 'Release ID',
    releaseChecking: 'Checking…',
    releaseUnavailable: 'Could not verify',
    showFullReleaseId: 'Show full ID',
    shortenReleaseId: 'Shorten',
    copyReleaseId: 'Copy release ID',
    releaseIdCopyFailed: 'Could not copy the release ID.',
    releaseIdHelp: 'Use this ID when checking which version is running.',
    pwaUpdateNotice: 'The latest version will be applied safely on the next launch. Your current input will be preserved.',
  },
};

export const getTranslations = (language: OriginLanguage) => TRANSLATIONS[language];
