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
  shareArtifact: string;
  editArtifact: string;
  finishEditing: string;
  shareCopied: string;
  shareFailed: string;
  sandboxRuntimeError: string;
  sandboxRuntimeDetail: string;
  restoreLastKnownGood: string;
  noLastKnownGood: string;
  openFullscreen: string;
  exitFullscreenLabel: string;
  presentation: string;
  exitPresentation: string;
  responsivePreview: string;
  phoneViewport: string;
  tabletViewport: string;
  fluidViewport: string;
  presentationKeyboardHint: string;
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
  queueLabel: string;
  queueSend: string;
  queueAcceptedNotice: string;
  queueSendNow: string;
  queueRemove: string;
  queueOfflineNotice: string;
  offlineNotice: string;
  attach: string;
  attachFile: string;
  addMenuImageDescription: string;
  addMenuAttachDescription: string;
  addMenuResearchDescription: string;
  addMenuAgentDescription: string;
  addMenuCodeDescription: string;
  addMenuCreateDescription: string;
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
  searchingLatest: string;
  composingAnswer: string;
  workDone: string;
  streamSourcesHeading: string;
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
  historyResetNote: string;
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
    closeWorkspace: '成果物を閉じる',
    showCode: 'コードを表示',
    showPreview: 'プレビューを表示',
    copyArtifact: '成果物をコピー',
    downloadArtifact: '成果物を保存',
    shareArtifact: '成果物を共有',
    editArtifact: '成果物を編集',
    finishEditing: '編集を完了',
    shareCopied: '共有用データをコピーしました。',
    shareFailed: '成果物を共有できませんでした。',
    sandboxRuntimeError: 'プレビューでエラーが起きました。',
    sandboxRuntimeDetail: 'プレビューを止めました。会話と保存内容は消えていません。',
    restoreLastKnownGood: '直前の正常な版に戻す',
    noLastKnownGood: '戻せる正常な版はまだありません。',
    openFullscreen: '全画面で表示',
    exitFullscreenLabel: '全画面表示を終了',
    presentation: 'プレゼン表示',
    exitPresentation: 'プレゼン表示を終了',
    responsivePreview: '表示幅を切り替える',
    phoneViewport: '375pxのスマホ表示',
    tabletViewport: '768pxのタブレット表示',
    fluidViewport: '幅100%のデスクトップ表示',
    presentationKeyboardHint: '左右の矢印キーでスライドを移動できます。',
    openSettings: '設定を開く',
    closeSettings: '設定を閉じる',
    settings: '設定',
    settingsDescription: '変更は自動で保存されます。',
    newConversation: '新しい会話',
    newConversationLabel: '新しい会話を始める',
    start: '始める →',
    startRequest: '依頼を送る',
    send: '送信',
    sendRequest: '依頼を送信',
    stop: '停止',
    stopGeneration: '生成を停止',
    queueLabel: '送信待ち',
    queueSend: '送信待ちに入れる',
    queueAcceptedNotice: '受け付けました。送信待ちは {count} 件です。今の回答が終わったら送ります。',
    queueSendNow: '今すぐ送信',
    queueRemove: '送信待ちから削除',
    queueOfflineNotice: 'オフラインのため送信待ちに保存しました。送信待ちは {count} 件です。接続が戻ると自動で送ります。',
    offlineNotice: 'オフライン中です。送った内容は送信待ちに保存され、接続が戻ると自動で送ります。',
    attach: '添付',
    attachFile: 'ファイルを添付',
    addMenuImageDescription: '言葉から画像を作ります',
    addMenuAttachDescription: '写真や文書を追加します',
    addMenuResearchDescription: '出典つきで詳しく調べます',
    addMenuAgentDescription: '計画を確認してから進めます',
    addMenuCodeDescription: 'プログラムを作って動かします',
    addMenuCreateDescription: '文章や資料などの成果物を作ります',
    attachedFiles: '添付ファイル',
    dropFiles: '画像またはテキストファイルをここにドロップ',
    removeAttachment: '添付を削除',
    attachmentTooLarge: 'ファイルは5MB以下にしてください。',
    attachmentTotalTooLarge: '添付ファイルの合計は10MB以下にしてください。',
    unsupportedAttachment: '画像かテキストファイルを選んでください。',
    attachmentReadError: 'ファイルを読み込めませんでした。',
    chatPlaceholder: 'やりたいことを、そのまま入力してください',
    homePlaceholder: 'やりたいことを、そのまま入力してください',
    workspaceLabel: '成果物のプレビュー',
    displayMode: '表示モード',
    previewTitle: 'プレビュー',
    userRequest: 'あなたの依頼',
    assistantResponse: 'ORIGINの回答',
    conversationLog: '会話履歴',
    thinking: '回答を準備しています…',
    searchingLatest: '最新の情報を調べています…',
    composingAnswer: '回答をまとめています…',
    workDone: 'できました',
    streamSourcesHeading: '確認した出典',
    responseReady: 'ORIGINの回答が届きました',
    error: 'エラーが発生しました。再度お試しください。',
    keyboardGuidance: 'Enterで送信、Shift+Enterで改行できます。',
    homeHeading: '今日は何をしますか？',
    homeDescription: '相談や調べもの、文章・資料づくり、コードまで。ふだんの言葉で頼むだけで、ORIGIN が進め方を選びます。',
    startWith: '始め方を選ぶ',
    freeOnlyNotice: '無料で使えるAIのみを利用します。詳しくは設定をご確認ください。',
    starterCards: [
      { title: '整理する', subtitle: '即時ロジック設計', description: '断片的な考えから、次の一歩を明確にする', prompt: '以下の内容を整理し、結論先行で構造化してください:\n' },
      { title: '比較する', subtitle: 'ディープリサーチ', description: '候補の違いと判断基準を見える形にする', prompt: '以下の候補について多角的な基準で比較分析してください:\n' },
      { title: '文章にする', subtitle: '成果物', description: 'メモを、伝わる文章・コードへ整える', prompt: '以下の内容を、用途に合った完成度の高い文章や作成物に整えてください:\n' },
      { title: '計画する', subtitle: 'データ構造化', description: '目的から、実行できる順序を組み立てる', prompt: '以下の目的を達成するための具体的実行計画を立ててください:\n' },
    ],
    languageHeading: '表示言語',
    languageJapanese: '日本語',
    languageEnglish: 'English',
    appearanceHeading: '明るさ（ライト／ダーク）',
    themeLight: '明るい',
    themeDark: '暗い',
    themeSystem: 'システム設定',
    systemThemeDescription: 'システム設定では、端末の明るさに合わせて、すべての画面を同じテーマで表示します。',
    historyHeading: '会話履歴',
    historyCount: (count) => `このブラウザーの会話は現在 ${count} 件です。`,
    historyFileLabel: '会話履歴ファイルを選択',
    exportHistory: '現在の会話を書き出す',
    importHistory: 'ファイルから現在の会話を読み込む',
    clearHistory: '新しく始める',
    portableHistoryNotice: '書き出しは、持ち運びできる JSON 形式です。読み込む前に内容を確認します。',
    historyImported: 'ファイルから現在の会話を読み込みました。',
    historyCleared: '現在の会話を履歴に保存し、新しい会話を始めました。',
    historyImportUnavailable: '会話履歴の読み込みはこの画面では利用できません。',
    historyImportFailed: 'ファイルを読み込めませんでした。',
    historyResetNote: '「新しく始める」では、現在の会話を履歴に保存します。履歴は消えません。',
    safetyHeading: '安全と費用',
    freeOnlyTitle: 'この版は無料AIだけを使います。',
    freeOnlyDescription: '有料AIへの自動切り替えは行いません。',
    secretWarning: 'パスワード、APIキー、トークン、秘密鍵を設定画面やチャットへ入力しないでください。',
    technicalInformation: '技術情報',
    releaseId: 'リリースID',
    releaseChecking: '確認中…',
    releaseUnavailable: '確認できません',
    showFullReleaseId: '全文を表示',
    shortenReleaseId: '短く表示',
    copyReleaseId: 'リリースIDをコピー',
    releaseIdCopyFailed: 'リリースIDをコピーできませんでした。',
    releaseIdHelp: '今動いている版を確認するときに使います。',
    pwaUpdateNotice: '最新版は、次に開いたときに安全に適用します。今入力している内容はそのまま残ります。',
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
    shareArtifact: 'Share artifact',
    editArtifact: 'Edit artifact',
    finishEditing: 'Finish editing',
    shareCopied: 'Share data copied.',
    shareFailed: 'This artifact could not be shared.',
    sandboxRuntimeError: 'An error occurred in the preview.',
    sandboxRuntimeDetail: 'The preview was stopped. Your conversation and saved content are still there.',
    restoreLastKnownGood: 'Go back to the last working version',
    noLastKnownGood: 'There is no working version to go back to yet.',
    openFullscreen: 'View fullscreen',
    exitFullscreenLabel: 'Exit fullscreen',
    presentation: 'Present',
    exitPresentation: 'Exit presentation',
    responsivePreview: 'Switch preview width',
    phoneViewport: '375px phone preview',
    tabletViewport: '768px tablet preview',
    fluidViewport: '100% desktop preview',
    presentationKeyboardHint: 'Use the left and right arrow keys to move between slides.',
    openSettings: 'Open settings',
    closeSettings: 'Close settings',
    settings: 'Settings',
    settingsDescription: 'Changes are saved automatically.',
    newConversation: 'New conversation',
    newConversationLabel: 'Start a new conversation',
    start: 'Start →',
    startRequest: 'Send request',
    send: 'Send',
    sendRequest: 'Send request',
    stop: 'Stop',
    stopGeneration: 'Stop generating',
    queueLabel: 'Queued',
    queueSend: 'Queue this request',
    queueAcceptedNotice: 'Queued. {count} request(s) waiting. It will be sent when the current answer finishes.',
    queueSendNow: 'Send now',
    queueRemove: 'Remove from queue',
    queueOfflineNotice: 'You are offline, so this was saved to the send queue. {count} request(s) waiting. It will be sent automatically when the connection returns.',
    offlineNotice: 'You are offline. What you send is kept in the send queue and sent automatically when the connection returns.',
    attach: 'Attach',
    attachFile: 'Attach a file',
    addMenuImageDescription: 'Create an image from words',
    addMenuAttachDescription: 'Add a photo or document',
    addMenuResearchDescription: 'Research in detail, with sources',
    addMenuAgentDescription: 'Make a plan and proceed after you confirm it',
    addMenuCodeDescription: 'Build and run code',
    addMenuCreateDescription: 'Create documents and other deliverables',
    attachedFiles: 'Attached files',
    dropFiles: 'Drop image or text files here',
    removeAttachment: 'Remove attachment',
    attachmentTooLarge: 'Each file must be 5MB or smaller.',
    attachmentTotalTooLarge: 'The combined attachment size must be 10MB or smaller.',
    unsupportedAttachment: 'Choose an image or text file.',
    attachmentReadError: 'This file could not be read.',
    chatPlaceholder: 'Describe what you want to get done',
    homePlaceholder: 'Describe what you want to get done',
    workspaceLabel: 'Artifact preview workspace',
    displayMode: 'Display mode',
    previewTitle: 'Preview',
    userRequest: 'Your request',
    assistantResponse: 'ORIGIN response',
    conversationLog: 'Conversation history',
    thinking: 'Preparing your answer…',
    searchingLatest: 'Searching for the latest information…',
    composingAnswer: 'Composing the answer…',
    workDone: 'Done',
    streamSourcesHeading: 'Sources checked',
    responseReady: 'ORIGIN response is ready',
    error: 'Something went wrong. Please try again.',
    keyboardGuidance: 'Press Enter to send, Shift+Enter for a new line.',
    homeHeading: 'What are we working on today?',
    homeDescription: 'Get help with questions, research, writing, documents, and code. Just ask in your own words, and ORIGIN will choose how to proceed.',
    startWith: 'Start with an executive workflow',
    freeOnlyNotice: 'Uses only AI options available at no cost. See Settings for details.',
    starterCards: [
      { title: 'Frame', subtitle: 'Define the decision', description: 'Turn incomplete context into a crisp executive brief', prompt: 'Frame the following context as an executive brief with the decision, evidence, risks, and recommended next action:\n' },
      { title: 'Evaluate', subtitle: 'Compare strategic options', description: 'Surface trade-offs, decision criteria, and a recommendation', prompt: 'Evaluate the following options against explicit decision criteria, summarize the trade-offs, and recommend a course of action:\n' },
      { title: 'Draft', subtitle: 'Create the deliverable', description: 'Convert working notes into executive-ready content or code', prompt: 'Transform the following notes into a concise, executive-ready deliverable with production-quality artifacts where useful:\n' },
      { title: 'Plan', subtitle: 'Build the roadmap', description: 'Translate the objective into owners, milestones, and next actions', prompt: 'Build an execution roadmap for the following objective, including priorities, owners, milestones, risks, and the immediate next action:\n' },
    ],
    languageHeading: 'Language',
    languageJapanese: 'Japanese',
    languageEnglish: 'English',
    appearanceHeading: 'Brightness (light / dark)',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    systemThemeDescription: 'System mode follows your device brightness and shows every screen in the same theme.',
    historyHeading: 'Conversation history',
    historyCount: (count) => `This browser has ${count} saved conversation(s).`,
    historyFileLabel: 'Choose conversation history file',
    exportHistory: 'Export current conversation',
    importHistory: 'Import current conversation from a file',
    clearHistory: 'Start new',
    portableHistoryNotice: 'Export uses a portable JSON format. The contents are checked before loading.',
    historyImported: 'The current conversation was loaded from the file.',
    historyCleared: 'The current conversation was saved to history, and a new conversation was started.',
    historyImportUnavailable: 'History import is unavailable in this view.',
    historyImportFailed: 'Could not load the file.',
    historyResetNote: '“Start new” saves the current conversation to history first. Your history is not deleted.',
    safetyHeading: 'Safety',
    freeOnlyTitle: 'ORIGIN does not use paid AI automatically.',
    freeOnlyDescription: 'There is no automatic switch to paid AI.',
    secretWarning: 'Do not enter passwords, API keys, tokens, or private keys here or in chat.',
    technicalInformation: 'Technical information',
    releaseId: 'Release ID',
    releaseChecking: 'Checking…',
    releaseUnavailable: 'Could not verify',
    showFullReleaseId: 'Show full ID',
    shortenReleaseId: 'Shorten',
    copyReleaseId: 'Copy release ID',
    releaseIdCopyFailed: 'Could not copy the release ID.',
    releaseIdHelp: 'Use this when checking which version is running now.',
    pwaUpdateNotice: 'The latest version will be applied safely the next time you open the app. What you are typing now will be kept as is.',
  },
};

export const getTranslations = (language: OriginLanguage) => TRANSLATIONS[language];
