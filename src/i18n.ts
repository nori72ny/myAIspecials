export type OriginLanguage = 'ja' | 'en';

type StarterCard = {
  title: string;
  subtitle: string;
  description: string;
  prompt: string;
};

type StarterChip = {
  label: string;
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
  voiceInput: string;
  voiceRecording: string;
  voiceTranscribing: string;
  voiceFinish: string;
  voiceCancel: string;
  voicePrivacyNotice: string;
  voicePrivacyStart: string;
  voicePermissionDenied: string;
  voiceUnsupported: string;
  voiceDailyLimit: string;
  voiceUnavailable: string;
  voiceFailed: string;
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
  starterChips: readonly StarterChip[];
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
  personal: {
    heading: string;
    description: string;
    groundedNote: string;
    toggleLabel: string;
    toggleOffNote: string;
    usageSummary: (count: number, max: number) => string;
    nearLimitNote: string;
    limitReachedNote: string;
    migrationMigrated: (count: number) => string;
    migrationFailed: string;
    passkeyHeading: string;
    passkeyDescription: string;
    passkeySetup: string;
    passkeyUnlock: string;
    passkeyWorking: string;
    passkeyDone: string;
    passkeyUnsupported: string;
    passkeyCancelled: string;
    passkeyFailed: string;
    profileHeading: string;
    profileCategoryLabel: string;
    profileCategories: { about: string; personality: string; preference: string; goal: string };
    profileTextLabel: string;
    profileTextPlaceholder: string;
    profileAdd: string;
    profileWarning: string;
    profileEmpty: string;
    blockedSave: string;
    memoryHeading: string;
    memoryEmpty: string;
    memoryKinds: { request: string; decision: string; preference: string; fact: string; commitment: string };
    originExplicit: string;
    originInferred: string;
    originLegacy: string;
    sourceFromConversation: (monthDay: string) => string;
    sourceMissing: string;
    updatedOn: (monthDay: string) => string;
    edit: string;
    saveEdit: string;
    cancelEdit: string;
    delete: string;
    sendToModel: string;
    deviceOnlyNote: string;
    historyFold: string;
    needsCheckHeading: string;
    needsCheckPrompt: string;
    useThis: string;
    deleteBoth: string;
    proposalsHeading: string;
    proposalsIntro: string;
    proposalFromRequest: (excerpt: string) => string;
    proposalApproveCombination: string;
    proposalDismiss: string;
    proposalNeedsCheckTitle: string;
    proposalNeedsCheckBody: string;
    proposalNeedsCheckApprove: string;
    proposalNeedsCheckDismiss: string;
    blockNoticesHeading: string;
    blockNoticesIntro: string;
    blockNoticeEntry: (monthDay: string, reasons: string) => string;
    blockCategories: {
      credential: string;
      'payment-card': string;
      'phone-number': string;
      'email-address': string;
      'date-of-birth': string;
      'pin-code': string;
      'government-id': string;
      'financial-account': string;
      'postal-address': string;
      'medical-information': string;
    };
    blockNoticesDismiss: string;
    styleHeading: string;
    styleIntro: string;
    styleEmpty: string;
    styleScopes: { general: string; work: string; private: string };
    styleForming: string;
    styleEstablished: string;
    styleEvidence: (turns: number) => string;
    styleOwnerSet: string;
    clearAll: string;
    clearAllConfirmTitle: string;
    clearAllConfirmBody: string;
    clearAllIncludeProfile: string;
    clearAllConfirm: string;
    clearAllCancel: string;
    clearAllDone: string;
    loadFailed: string;
  };
  safetyHeading: string;
  freeOnlyTitle: string;
  freeOnlyDescription: string;
  secretWarning: string;
  secretWarningException: string;
  originKeysNote: string;
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
    addMenuAgentDescription: '手順の多い調べものや文書づくりを任せます',
    addMenuCodeDescription: 'プログラム自体を作ったり直したりします',
    addMenuCreateDescription: '文章や資料などの成果物を作ります',
    voiceInput: '音声入力',
    voiceRecording: '録音中',
    voiceTranscribing: '文字にしています…',
    voiceFinish: '文字にする',
    voiceCancel: 'やめる',
    voicePrivacyNotice: '音声は文字起こしのためだけに送信され、保存されません',
    voicePrivacyStart: 'はじめる',
    voicePermissionDenied: 'マイクの使用が許可されませんでした。ブラウザの設定でマイクを許可してください',
    voiceUnsupported: 'このブラウザでは音声入力を使えません',
    voiceDailyLimit: '今日の音声入力の上限に達しました',
    voiceUnavailable: '音声入力は現在使えません',
    voiceFailed: '文字起こしできませんでした。もう一度お試しください',
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
    starterChips: [
      { label: 'ニュースを調べる', prompt: '今日の主なニュースを調べて、要点を教えてください' },
      { label: '企画書を作る', prompt: '新しい企画の企画書のたたき台を作ってください' },
      { label: '画像を描く', prompt: '緑の多い公園の風景イラストを描いてください' },
      { label: 'メールの下書き', prompt: 'お礼のメールの下書きを作ってください' },
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
    portableHistoryNotice: '書き出したファイルは、別の端末でも読み込めます。読み込む前に、ORIGIN がファイルの内容を確認します。',
    historyImported: 'ファイルから現在の会話を読み込みました。',
    historyCleared: '現在の会話を履歴に保存し、新しい会話を始めました。',
    historyImportUnavailable: '会話履歴の読み込みはこの画面では利用できません。',
    historyImportFailed: 'ファイルを読み込めませんでした。',
    historyResetNote: '「新しく始める」では、現在の会話を履歴に保存します。履歴は消えません。',
    personal: {
      heading: 'あなたについて',
      description: 'あなたについて書いたことと、会話の中で覚えたことを、ここで見直せます。回答を、あなたに合わせて整えるために使います。',
      groundedNote: '調べものへの回答には、ここに書いた内容は使いません。',
      toggleLabel: '覚えている内容を、回答に活かす',
      toggleOffNote: 'オフにすると、新しく覚えることも、回答に使うことも止まります。覚えた内容は消えません。',
      usageSummary: (count, max) => `いま ${count} 件を覚えています（上限は ${max} 件です）。`,
      nearLimitNote: '上限に近づいています。いらなくなった内容があれば、整理してみてください。',
      limitReachedNote: '上限に達したため、会話から新しく覚えることは一時停止しています。あなたが書いた内容と、「覚えておいて」と言った内容は、これまでどおり保存されます。',
      migrationMigrated: (count) => `前の仕組みで覚えていた ${count} 件を、こちらへ引き継ぎました。`,
      migrationFailed: '前の仕組みからの移行がうまくいきませんでした。次に開いたときに、もう一度試します。',
      passkeyHeading: '端末のカギで守る',
      passkeyDescription: '指紋・顔認証などのパスキーでカギを作ると、覚えた内容をより強く守れます。カギはこの端末の中だけで使われ、外に送られることはありません。',
      passkeySetup: 'パスキーを設定する',
      passkeyUnlock: 'パスキーで守り直す',
      passkeyWorking: '処理しています…',
      passkeyDone: 'パスキーのカギで守るようにしました。',
      passkeyUnsupported: 'この端末・ブラウザではパスキーを使えませんでした。',
      passkeyCancelled: 'パスキーの確認がキャンセルされました。',
      passkeyFailed: 'パスキーの設定に失敗しました。時間をおいて、もう一度お試しください。',
      profileHeading: 'プロフィール',
      profileCategoryLabel: 'カテゴリ',
      profileCategories: { about: 'わたしについて', personality: '性格・考え方', preference: '好み', goal: 'やりたいこと・目標' },
      profileTextLabel: '内容',
      profileTextPlaceholder: '例：短くまとめてほしい',
      profileAdd: '追加する',
      profileWarning: '住所・電話番号・生年月日・カード情報は書かないでください',
      profileEmpty: 'まだ何も書かれていません。',
      blockedSave: 'この内容は保存できませんでした。住所・電話番号・カード番号などが含まれていないか、見直してみてください。',
      memoryHeading: 'ORIGINが覚えていること',
      memoryEmpty: 'まだ覚えていることはありません。',
      memoryKinds: { request: '頼まれごと', decision: '決めたこと', preference: '好み', fact: 'あなたのこと', commitment: 'ORIGINの約束' },
      originExplicit: 'あなたが覚えさせた',
      originInferred: '会話から',
      originLegacy: '前の仕組みから引き継ぎ',
      sourceFromConversation: (monthDay) => `${monthDay}の会話から`,
      sourceMissing: '出典の情報がありません',
      updatedOn: (monthDay) => `${monthDay}に更新`,
      edit: '編集',
      saveEdit: '保存',
      cancelEdit: 'やめる',
      delete: '消す',
      sendToModel: 'チャットのAIに渡す',
      deviceOnlyNote: 'この端末の中だけで使います',
      historyFold: '置き換え済み・終わった内容',
      needsCheckHeading: '内容が食い違っているもの',
      needsCheckPrompt: 'どちらが今の内容ですか',
      useThis: 'こちらを使う',
      deleteBoth: '両方消す',
      proposalsHeading: '合わせて進める提案',
      proposalsIntro: '覚えている内容を合わせると、頼みごとが進めやすくなりそうな組み合わせです。使うかどうかは、ここで選べます。',
      proposalFromRequest: (excerpt) => `「${excerpt}」という頼みごとから`,
      proposalApproveCombination: '合わせて進める',
      proposalDismiss: '今は使わない',
      proposalNeedsCheckTitle: '食い違っている内容の確認',
      proposalNeedsCheckBody: 'どちらも、覚えている内容として残っています。新しい方を使うか、このままにしておくか選べます。',
      proposalNeedsCheckApprove: '新しい方を使う',
      proposalNeedsCheckDismiss: '今は決めない',
      blockNoticesHeading: '保存しなかった内容のお知らせ',
      blockNoticesIntro: '会話から覚えようとした内容に、保存できないものが含まれていたため、保存しませんでした。内容そのものは、ここにも残していません。',
      blockNoticeEntry: (monthDay, reasons) => `${monthDay}の会話から：${reasons}らしい内容が含まれていたため、保存しませんでした`,
      blockCategories: {
        credential: 'パスワードやAPIキー',
        'payment-card': 'カード番号',
        'phone-number': '電話番号',
        'email-address': 'メールアドレス',
        'date-of-birth': '生年月日',
        'pin-code': '暗証番号',
        'government-id': 'マイナンバーなどの公的な番号',
        'financial-account': '口座番号',
        'postal-address': '住所',
        'medical-information': '医療に関する情報',
      },
      blockNoticesDismiss: '分かりました',
      styleHeading: '話し方・答え方の特徴',
      styleIntro: '会話の中での言い方から、ORIGINが感じ取った特徴です。代理で答えるときや、声で答えるときの言い方に使います。違っていたら、短く直せます。',
      styleEmpty: 'まだ特徴は記録されていません。会話を重ねると、ここに少しずつ出てきます。',
      styleScopes: { general: 'いつも', work: '仕事のとき', private: 'プライベートのとき' },
      styleForming: '観察中',
      styleEstablished: '特徴として記録',
      styleEvidence: (turns) => `${turns} 回の会話から`,
      styleOwnerSet: 'あなたが書いた内容',
      clearAll: '覚えていることを全て消す',
      clearAllConfirmTitle: '覚えていることを全て消しますか',
      clearAllConfirmBody: '会話の履歴は消えません。覚えていることだけが消えます。',
      clearAllIncludeProfile: 'プロフィールも一緒に消す',
      clearAllConfirm: '全て消す',
      clearAllCancel: 'やめる',
      clearAllDone: '覚えていることを全て消しました。',
      loadFailed: '覚えている内容を読み込めませんでした。',
    },
    safetyHeading: '安全と費用',
    freeOnlyTitle: 'この版は無料AIだけを使います。',
    freeOnlyDescription: '有料AIへの自動切り替えは行いません。',
    secretWarning: '外部サービスのパスワード、APIキー、トークン、秘密鍵を、この画面やチャットへ入力しないでください。',
    secretWarningException: 'この画面の『実行キー』と『管理者キー』はORIGIN専用のキーです。入力先はこの画面だけで、保存はされません。',
    originKeysNote: '実行キーと管理者キーは、どちらもORIGIN専用のキーです。外部サービスのAPIキーとは別物で、入力したキーは保存されません。',
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
    addMenuAgentDescription: 'Delegate multi-step research and document work',
    addMenuCodeDescription: 'Create or fix the program itself',
    addMenuCreateDescription: 'Create documents and other deliverables',
    voiceInput: 'Voice input',
    voiceRecording: 'Recording',
    voiceTranscribing: 'Turning your voice into text…',
    voiceFinish: 'Transcribe',
    voiceCancel: 'Cancel',
    voicePrivacyNotice: 'Your voice is sent only to be transcribed and is never saved.',
    voicePrivacyStart: 'Start',
    voicePermissionDenied: 'Microphone access was not allowed. Please allow the microphone in your browser settings.',
    voiceUnsupported: 'Voice input is not available in this browser.',
    voiceDailyLimit: "You've reached today's voice input limit.",
    voiceUnavailable: 'Voice input is not available right now.',
    voiceFailed: 'Transcription failed. Please try again.',
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
    starterChips: [
      { label: 'Check the news', prompt: "Look into today's top news and tell me the key points" },
      { label: 'Draft a proposal', prompt: 'Create a first draft of a proposal document for a new project' },
      { label: 'Draw an image', prompt: 'Draw an illustration of a lush green park scene' },
      { label: 'Draft an email', prompt: 'Draft a thank-you email' },
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
    portableHistoryNotice: 'The exported file can also be loaded on another device. ORIGIN checks the file contents before loading.',
    historyImported: 'The current conversation was loaded from the file.',
    historyCleared: 'The current conversation was saved to history, and a new conversation was started.',
    historyImportUnavailable: 'History import is unavailable in this view.',
    historyImportFailed: 'Could not load the file.',
    historyResetNote: '“Start new” saves the current conversation to history first. Your history is not deleted.',
    personal: {
      heading: 'About you',
      description: 'Review what you have written about yourself and what ORIGIN has remembered from your conversations. These are used to shape answers for you.',
      groundedNote: 'Researched answers do not use anything written here.',
      toggleLabel: 'Use what ORIGIN remembers in its answers',
      toggleOffNote: 'While this is off, ORIGIN stops remembering new things and stops using them in answers. What is already remembered is not deleted.',
      usageSummary: (count, max) => `${count} item(s) are remembered (the limit is ${max}).`,
      nearLimitNote: 'You are getting close to the limit. Consider tidying up anything you no longer need.',
      limitReachedNote: 'The limit has been reached, so remembering new things from conversations is paused. What you write yourself, and anything you ask ORIGIN to remember, is still saved as before.',
      migrationMigrated: (count) => `${count} item(s) remembered by the previous system were carried over here.`,
      migrationFailed: 'The carry-over from the previous system did not finish. It will be tried again the next time you open this.',
      passkeyHeading: 'Protect with a device key',
      passkeyDescription: 'A passkey (fingerprint, face, or device PIN) creates a stronger key for what ORIGIN remembers. The key is used only on this device and is never sent anywhere.',
      passkeySetup: 'Set up a passkey',
      passkeyUnlock: 'Re-protect with my passkey',
      passkeyWorking: 'Working…',
      passkeyDone: 'What ORIGIN remembers is now protected with your passkey key.',
      passkeyUnsupported: 'Passkeys are not available on this device or browser.',
      passkeyCancelled: 'Passkey confirmation was cancelled.',
      passkeyFailed: 'Passkey setup failed. Please wait a moment and try again.',
      profileHeading: 'Profile',
      profileCategoryLabel: 'Category',
      profileCategories: { about: 'About me', personality: 'Personality & outlook', preference: 'Preferences', goal: 'Goals' },
      profileTextLabel: 'Details',
      profileTextPlaceholder: 'Example: Keep answers short',
      profileAdd: 'Add',
      profileWarning: 'Please do not write addresses, phone numbers, birth dates, or card details here',
      profileEmpty: 'Nothing written yet.',
      blockedSave: 'This could not be saved. Please check that it does not include an address, phone number, card number, or similar detail.',
      memoryHeading: 'What ORIGIN remembers',
      memoryEmpty: 'Nothing is remembered yet.',
      memoryKinds: { request: 'Requests', decision: 'Decisions', preference: 'Preferences', fact: 'About you', commitment: "ORIGIN's promises" },
      originExplicit: 'You asked ORIGIN to remember this',
      originInferred: 'From a conversation',
      originLegacy: 'Carried over from the previous system',
      sourceFromConversation: (monthDay) => `From a conversation on ${monthDay}`,
      sourceMissing: 'No source information',
      updatedOn: (monthDay) => `Updated ${monthDay}`,
      edit: 'Edit',
      saveEdit: 'Save',
      cancelEdit: 'Cancel',
      delete: 'Delete',
      sendToModel: 'Share with the chat AI',
      deviceOnlyNote: 'Used only on this device',
      historyFold: 'Replaced or finished items',
      needsCheckHeading: 'Items that do not agree',
      needsCheckPrompt: 'Which one is current?',
      useThis: 'Use this one',
      deleteBoth: 'Delete both',
      proposalsHeading: 'Combinations to try',
      proposalsIntro: 'Combinations of things ORIGIN remembers that could make your requests go more smoothly. You choose which ones to use.',
      proposalFromRequest: (excerpt) => `From your request: “${excerpt}”`,
      proposalApproveCombination: 'Use this combination',
      proposalDismiss: 'Not now',
      proposalNeedsCheckTitle: 'Checking items that do not agree',
      proposalNeedsCheckBody: 'Both are still remembered. You can switch to the newer one, or leave them as they are for now.',
      proposalNeedsCheckApprove: 'Use the newer one',
      proposalNeedsCheckDismiss: 'Decide later',
      blockNoticesHeading: 'Things that were not saved',
      blockNoticesIntro: 'Something ORIGIN tried to remember from a conversation contained details that cannot be stored, so it was not saved. The content itself is not kept here either.',
      blockNoticeEntry: (monthDay, reasons) => `From a conversation on ${monthDay}: not saved, because it seemed to include ${reasons}.`,
      blockCategories: {
        credential: 'a password or API key',
        'payment-card': 'a card number',
        'phone-number': 'a phone number',
        'email-address': 'an email address',
        'date-of-birth': 'a date of birth',
        'pin-code': 'a PIN',
        'government-id': 'a government ID number',
        'financial-account': 'an account number',
        'postal-address': 'an address',
        'medical-information': 'medical information',
      },
      blockNoticesDismiss: 'Got it',
      styleHeading: 'How you talk and answer',
      styleIntro: 'Traits ORIGIN has picked up from the way you phrase things in conversation. They shape how it answers in your stead and how spoken answers are phrased. If one feels wrong, a short edit is enough.',
      styleEmpty: 'No traits recorded yet. They will appear here little by little as you keep talking.',
      styleScopes: { general: 'In general', work: 'At work', private: 'In private' },
      styleForming: 'Still observing',
      styleEstablished: 'Recorded as a trait',
      styleEvidence: (turns) => `From ${turns} conversations`,
      styleOwnerSet: 'Written by you',
      clearAll: 'Delete everything ORIGIN remembers',
      clearAllConfirmTitle: 'Delete everything ORIGIN remembers?',
      clearAllConfirmBody: 'Your conversation history is not deleted. Only what ORIGIN remembers is removed.',
      clearAllIncludeProfile: 'Also delete my profile',
      clearAllConfirm: 'Delete all',
      clearAllCancel: 'Cancel',
      clearAllDone: 'Everything ORIGIN remembered has been deleted.',
      loadFailed: 'What ORIGIN remembers could not be loaded.',
    },
    safetyHeading: 'Safety',
    freeOnlyTitle: 'ORIGIN does not use paid AI automatically.',
    freeOnlyDescription: 'There is no automatic switch to paid AI.',
    secretWarning: 'Do not enter passwords, API keys, tokens, or private keys for external services here or in chat.',
    secretWarningException: 'The "Execution key" and "Administrator key" on this screen are ORIGIN-only keys. They are entered only on this screen and are never saved.',
    originKeysNote: 'The execution key and the administrator key are both ORIGIN-only keys. They are not API keys for external services, and entered keys are never saved.',
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
