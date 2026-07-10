// ValidationSuiteData.ts - Sprint 21: Benchmark Generation & Seed Data
import { 
  MissionBenchmark, 
  DifficultyLevel, 
  GoldenAnswer,
  WorldBenchmarkStats,
  WeaknessAnalysis,
  DailyEvolutionLog,
  QualityWeeklyReport
} from "./ValidationSuiteTypes";

// 20 Categories defined by the user
export const VALIDATION_CATEGORIES = [
  "日常", "仕事", "企画", "営業", "マーケティング",
  "文章作成", "要約", "翻訳", "比較", "調査",
  "プログラミング", "画像生成", "資料作成", "表作成", "旅行",
  "教育", "家族", "健康", "アイデア", "意思決定"
];

const DIFFICULTIES: DifficultyLevel[] = ["Easy", "Normal", "Hard", "Expert", "Impossible"];

// Programmatic Generator to build EXACTLY 300 high-fidelity benchmarks
export function generate300Missions(): MissionBenchmark[] {
  const list: MissionBenchmark[] = [];
  
  // Category-specific template arrays
  const templates: Record<string, {
    title: string;
    details: string[];
    idealPattern: string;
    minPattern: string;
    ngPattern: string;
    criteriaList: string[];
  }> = {
    "日常": {
      title: "朝の時間を最大化する%ITEM%習慣設計",
      details: [
        "10分でできるマインドフルネス呼吸法と軽ストレッチの組み合わせ",
        "二日酔いの朝に水分補給と自律神経をリセットするルーティン",
        "朝寝坊した日に5分で頭をシャキッとさせる緊急呼吸ワーク"
      ],
      idealPattern: "科学的な裏付け(コルチゾール、交感神経、マインドフルネス)に基づき、分刻みのステップ、推奨する水分・栄養素、注意点を完璧に整理したガント形式のタイムライン。",
      minPattern: "「ストレッチをして水を飲みましょう」といった一般的な推奨にとどまり、時間配分や生理学的効果の解説が不足しているもの。",
      ngPattern: "「気合で起きる」「冷水を頭から浴びる」といった医学的にリスクがあり、科学的合理性を欠いた精神論の記述。",
      criteriaList: ["1分ごとの時間割が明記されているか", "生理学的な裏付けが1点以上あるか", "緊急時のショートカット版が用意されているか"]
    },
    "仕事": {
      title: "プロジェクトの%ITEM%に伴うステークホルダー向け報告書",
      details: [
        "基幹システムリプレイスが3ヶ月遅延した際の説明会アジェンダとメール",
        "新規取引先への初回提案で予算超過した際の調整用ドキュメント",
        "チームのメンバーが急遽退職することになった際の業務引き継ぎ計画"
      ],
      idealPattern: "3部構成(事実報告、根本原因の定量的分析、再発防止策とタイムライン)を網羅。謝罪に終始せず、次回合意形成に必要な3つの具体的オプション(コスト・時間・スコープのトレードオフ)を提示していること。",
      minPattern: "「遅れます、すみません」という謝罪と、抽象的な「今後は気をつけます」という精神論のみで構成された文章。",
      ngPattern: "遅延の責任をメンバー個人や外部ベンダーに転嫁し、感情的かつ組織的な信頼を著しく失墜させる文面。",
      criteriaList: ["定量的な影響範囲(日数、コスト)が明記されているか", "責任転嫁がなく、能動的な再発防止策があるか", "意思決定用の複数シナリオが提示されているか"]
    },
    "企画": {
      title: "次世代型%ITEM%のプロダクト企画・検証仕様書",
      details: [
        "AI搭載の自動パーソナライズ型スマート水筒の開発企画",
        "近未来風コワーキングスペース「Silent-Focus」の運営要件",
        "30代単身者向けの完全自動栄養管理冷蔵庫のサブスクモデル"
      ],
      idealPattern: "MECEに基づいたプロダクト要求仕様書(PRD)。ターゲットペルソナ、コア体験(UXジャーニーマップ)、技術的実現可能性、初期MVPのKPI指標、法規制リスク(安全基準、プライバシー)を網羅した詳細企画。",
      minPattern: "「便利でAIがすごいやつ」といった機能アイデアの羅列にとどまり、ビジネスモデルや検証コストの記述がないもの。",
      ngPattern: "既存製品のカタログスペックをコピーしただけで、新規性や顧客検証ステップが一切記述されていないもの。",
      criteriaList: ["技術スタックとMVP開発のスケジュールがあるか", "法的・プライバシー関連の懸念点が識別されているか", "検証用の主要メトリクス(KPI)が3つ以上定義されているか"]
    },
    "営業": {
      title: "大企業向け%ITEM%ソリューション提案の架電・提案スクリプト",
      details: [
        "セキュリティ対策が不十分な地方自治体へのクラウド移行提案",
        "競合他社に既存契約を奪われそうな状況からのリプレイス防衛案",
        "役員クラスへのコールドアウトバウンドコールと決裁権奪取戦略"
      ],
      idealPattern: "SPIN話法に基づいたヒアリング項目、顧客の「想定反論(オブジェクションハンドリング)」に対する3段階の論理反論、導入効果の定量的シミュレーション、ネクストアクションへの誘導プロセスが洗練されていること。",
      minPattern: "自社製品の強みだけを一方的にアピールし、顧客の課題意識や不満に寄り添うヒアリング設計が抜けているもの。",
      ngPattern: "「今なら半額です」という安易な値下げに頼り、製品価値を自ら毀損させたり、他社誹謗を行う内容。",
      criteriaList: ["想定反論に対する切り返し文面が3パターン以上あるか", "顧客の投資対効果(ROI)の算出アプローチが記述されているか", "ヒアリングのフレームワーク(SPINなど)に沿っているか"]
    },
    "マーケティング": {
      title: "Z世代向け%ITEM%ローンチに伴う統合マーケティング戦略(IMC)",
      details: [
        "ノンアルコールクラフトビールのクローズドSNSキャンペーン",
        "ポータブル空気清浄機のTikTok発信による購買行動誘発プラン",
        "サブスク型古着レンタルサービスの大学サークル連携企画"
      ],
      idealPattern: "ファネル分析(認知・興味・比較・購入・推奨)に基づくチャネルミックス選定。クリエイティブのトーン＆マナー、インフルエンサー施策の想定費用・インプレッション換算値、UGC誘発のための仕掛けが完璧に設計されていること。",
      minPattern: "「TikTokで動画をバズらせ、SNSキャンペーンをやります」といった、具体性のない単発アイデアの記述。",
      ngPattern: "炎上リスクやステマ(ステルスマーケティング)規制を考慮せず、インフルエンサーに一方的な優良誤認を促す指示。",
      criteriaList: ["ファネル別の目標数値(CPA, CVR)が記述されているか", "炎上防止ガイドライン・コンプライアンス対策があるか", "UGCを誘発する具体的トリガーが2つ以上あるか"]
    },
    "文章作成": {
      title: "Web3.0と自律AIをテーマにした%ITEM%解説記事",
      details: [
        "ブロックチェーン初心者でも挫折しない、DAOの運営仕組みと実例",
        "自律エージェントが自律的に稼ぐ時代の税制・法的論点の解説",
        "企業のDX推進者が最初に読むべき「AIエージェント導入の壁」"
      ],
      idealPattern: "読者ターゲットに合わせた絶妙なトーン。導入(フック)、対比、比喩を用いた噛み砕いた技術解説、実用的チェックリスト、今後のマイルストーンを綺麗に整理した、SEOフレンドリーな構成(H2/H3タグ明記)。",
      minPattern: "専門用語をただ羅列した辞書的な説明で、初心者が読んでも具体的なイメージが全く湧かない構成。",
      ngPattern: "不正確な情報を断定的に書き連ね、読者の法的リスクや資産運用の重大な不利益を誘発するような記述。",
      criteriaList: ["前提知識のない読者向けの具体的な比喩が使用されているか", "専門用語に対する用語集や解説枠があるか", "H2, H3の適切なネスト構造で読みやすいか"]
    },
    "要約": {
      title: "難解な%ITEM%に関する多角的な超要約",
      details: [
        "100ページに及ぶ最新の地球温暖化規制に関する国際条約草案",
        "最新のマルチモーダル大規模言語モデルのテクニカルレポート",
        "数万文字に及ぶ株主総会議事録と中期経営計画アップデート"
      ],
      idealPattern: "全体像を鳥瞰できる「エグゼクティブサマリー(3行)」、重要キーワードの背景定義、対立構造や今後の論点をまとめたマインドマップ風箇条書き、及び決定事項と未決事項の明確なマッピング。",
      minPattern: "テキストの前後から重要そうな文を適当につなぎ合わせただけで、論理的な文脈やつながりが崩壊しているもの。",
      ngPattern: "原文に記載されていない独自の解釈や推測を勝手に混入させ、誤った結論へ読者を誘導するもの(ハルシネーション)。",
      criteriaList: ["決定事項と未決事項(ネクストタスク)が峻別されているか", "要約のターゲット読者層に合わせた平易な表現への翻訳がなされているか", "数値データ(パーセンテージ、日付)が正確に継承されているか"]
    },
    "翻訳": {
      title: "IT英語・ビジネス英語における%ITEM%のローカライズ翻訳",
      details: [
        "海外ベンダーのAPIドキュメントにおけるエラー例外コードの対処法",
        "グローバルM&A契約書における秘密保持条項(NDA)の法的対応訳",
        "シリコンバレー企業のピッチデッキにおけるVC向けキャッチフレーズ"
      ],
      idealPattern: "単なる直訳ではなく、コンテキストを読み取った自然な翻訳。文化的な背景、ターゲット地域の慣習(日本語なら敬語、ビジネスメールの様式)、法的定義を完璧に整合させ、原文のニュアンス(皮肉や熱意)を完全保持。",
      minPattern: "自動翻訳エンジンを通しただけの不自然な日本語。主語と目的語の関係が不明瞭で、ビジネス現場で使用するには修正が必要なもの。",
      ngPattern: "法的契約における禁止事項(Shall not)を許可(Shall)と逆訳するなど、実害が生じる致命的な誤訳。",
      criteriaList: ["単語の直訳ではなく文脈適合語が選択されているか", "法務・技術用語の標準規格に適合しているか", "原文の強調・感情表現(トーン)が的確に表現されているか"]
    },
    "比較": {
      title: "最先端%ITEM%サービスの比較検討マトリクス",
      details: [
        "ベクトルデータベース(Pinecone vs Milvus vs Qdrant)の比較",
        "大企業向けERPシステム(SAP vs Oracle vs Salesforce)の導入障壁",
        "パーソナルヘルスケアトラッカー(Oura Ring vs Apple Watch vs WHOOP)"
      ],
      idealPattern: "5軸(コスト、スケーラビリティ、運用負荷、セキュリティ、将来性)の定量的マトリクス表。各製品の圧倒的な強みと、「隠れたデメリット」、想定する最適なユースケース(ターゲット企業規模など)を網羅した包括的な意思決定支援シート。",
      minPattern: "各製品の公式サイトから抜粋した基本仕様のみを並べ、実質的な比較・選定推奨ロジックが欠如しているもの。",
      ngPattern: "特定の製品を著しく偏愛・擁護、あるいは競合製品に対して事実無根の批判を加え、比較の公平性を欠いた記述。",
      criteriaList: ["5項目以上の明確な評価軸で比較されているか", "それぞれのデメリットやボトルネックが明記されているか", "推奨決定木(If X, then choose Y)があるか"]
    },
    "調査": {
      title: "グローバル%ITEM%に関する市場調査・動向レポート",
      details: [
        "欧州におけるプラスチック規制に伴う生分解性プラスチック市場の現状",
        "米国における生成AIコードジェネレータの法的訴訟と著作権保護の動向",
        "日本における若年層のマイカー離れとライドシェア普及率の相関調査"
      ],
      idealPattern: "信頼性の高い情報源(ガートナー、統計局、学術論文、JETRO等)のデータ明記。市場規模(CAGR)、法規制、プレイヤー分析(PESTLE分析、ポーターのファイブフォース)、今後5年間の予測シナリオを整理した完成度。",
      minPattern: "「最近流行っているようです」という個人のSNSの感想を基にした抽象的な記述で、定量的根拠が皆無なもの。",
      ngPattern: "出所不明の古いデータや個人の主観のみをベースに市場環境を楽観視し、新規参入に重大な損失を招きかねない情報提供。",
      criteriaList: ["市場規模(CAGR)や実測統計データが含まれているか", "PESTLEなどの市場調査フレームワークが活用されているか", "参照元、もしくは調査仮説の検証方法が定義されているか"]
    },
    "プログラミング": {
      title: "%ITEM%におけるセキュアかつ堅牢な設計・実装コード",
      details: [
        "Node.jsでのJWT認証と、安全なリフレッシュトークンローテーション",
        "Rustでのマルチスレッド非同期メッセージキュー・コンシューマの設計",
        "Next.js App RouterでのStreaming SSRを活用したDashboardコンポーネント"
      ],
      idealPattern: "TypeScript/Rust等でのバグのない実コード。エッジケース処理(エラーハンドリング、接続タイムアウト、メモリリーク防止)、セキュリティ対策(SQLインジェクション、XSS、CSRC、レートリミット)、および実行検証用のJSDoc/テストコード。",
      minPattern: "エラーハンドリングが完全に省略されており、本番環境にデプロイすると即時クラッシュや脆弱性を引き起こす擬似コード。",
      ngPattern: "構文エラー(Syntax Error)があり、実行すらできない壊れたコードブロック、もしくは安全性の低いライブラリの推奨。",
      criteriaList: ["厳格なエラーハンドリング(Try-Catch、例外伝播)があるか", "型定義(TypeScript)がAnyを使わずに正確に書かれているか", "セキュリティ的なガードレール(サニタイズ、入力検証)があるか"]
    },
    "画像生成": {
      title: "商用利用可能な%ITEM%プロンプト設計とスタイル制御",
      details: [
        "ハイエンド時計ブランドの広告用、水滴が滴るミニマルなスタジオ写真",
        "サイバーパンク風東京の路地裏、ネオンライトと水たまりの反射",
        "エドワード・ホッパー風の光と影、哀愁漂うモダンカフェのイラスト"
      ],
      idealPattern: "Midjourney/Stable Diffusion等で狙った構図を100%出力するための緻密なプロンプト。カメラレンズ、照明(HDRI、ボリュメトリックライト)、アスペクト比、カラーパレット、ネガティブプロンプトの指定が詳細に構造化されていること。",
      minPattern: "「カッコいい東京の夜」といった単純なフレーズのみで、構図や画質、アートスタイルを一切制御できていない記述。",
      ngPattern: "著作権や肖像権、商標を直接侵害する実在人物や競合ロゴを直接プロンプトに含めて生成しようとする危険な指示。",
      criteriaList: ["カメラアングル、照明、質感のパラメータが明記されているか", "ノイズや歪みを防ぐネガティブキーワードが定義されているか", "生成エンジン別のパラメーター(V6, SDXL等)に対応しているか"]
    },
    "資料作成": {
      title: "投資家を惹きつける%ITEM%プレゼン資料のスライド構成案",
      details: [
        "シード期SaaSスタートアップの、課題解決からユニットエコノミクス",
        "社内のDX推進タスクフォース立ち上げに伴う、経営陣向け稟議資料",
        "新規地方創生ファンディングプロジェクトの、住民向け説明資料"
      ],
      idealPattern: "1スライド・1メッセージの徹底。イントロからアウトロまでのスライドストーリーライン(全10枚)。各スライドの「タイトル」「キーメッセージ」「配置すべきビジュアル/グラフの指定」「発表者スクリプト」まで完全に設計された構成案。",
      minPattern: "スライドに書く長文をただつらつらと書き並べただけで、スライドとしての構造化(レイアウト、対比、重要性)がなされていないもの。",
      ngPattern: "経営陣向け資料なのに細かすぎる技術仕様のみを長々と説明し、肝心のROIや財務インパクトが一切語られていない構成。",
      criteriaList: ["各スライドのワイヤーフレーム(レイアウト配置案)があるか", "トーカーズノート(スピーカー原稿)が用意されているか", "一貫したストーリー構成(Why -> What -> How -> ROI)があるか"]
    },
    "表作成": {
      title: "KPI集計・予測シミュレーションを行う%ITEM%スプレッドシート設計",
      details: [
        "3ヵ年の新規出店PL(損益計算書)およびキャッシュフロー予測モデル",
        "広告運用のアトリビューションモデルと日次ROAS管理シート",
        "全社エンジニアの稼働率・工数アロケーションと原価計算テーブル"
      ],
      idealPattern: "Excel/Spreadsheetの具体的な数式(SUMIFS, VLOOKUP/XLOOKUP, Dynamic Array)とカラム設計。データの「入力シート」「マスタ」「集計用ピボットダッシュボード」を明確に分け、データ入力規則やエラー検知(ISERROR)まで考慮した設計書。",
      minPattern: "カラム名が適当に並んでいるだけで、数式やデータの流れ、集計ロジックが曖昧なもの。",
      ngPattern: "循環参照を引き起こす数式設計や、データの整合性が崩れるセルの直接上書きを推奨するような、運用崩壊する設計書。",
      criteriaList: ["入力・計算・出力の3レイヤー構造が設計されているか", "異常値を自動で検知する条件付き書式や検証式があるか", "Excel/スプレッドシートでコピペ可能な正確な関数表記があるか"]
    },
    "旅行": {
      title: "歴史とカルチャーを満喫する%ITEM%完全オーダーメイド旅程",
      details: [
        "シニア世代の足腰に配慮した、京都の隠れた名刹を巡る2泊3日の旅",
        "写真家向けの、北欧フィンランドのオーロラ撮影とサウナ三昧5日間",
        "建築学生のための、ル・コルビュジエとパリの近代建築を巡る強行日程"
      ],
      idealPattern: "移動手段、乗り換え時間、混雑ピーク時間、飲食店の事前予約リンク情報、バリアフリー対応状況、緊急時の最寄りの救急病院情報まで網羅された、1時間刻みのパーフェクトな行程表。天候急変時のバックアッププラン(Plan B)も搭載。",
      minPattern: "「1日目：観光地A、2日目：観光地B」といった、旅行パンフレットの単なる転記レベルの抽象的なスケジュール。",
      ngPattern: "移動距離や交通手段の運行頻度を完全に無視し、1日の中に到底不可能な過密スケジュールを詰め込んだ破綻した旅程。",
      criteriaList: ["天候不順や混雑時のオルタナティブ案(Plan B)が用意されているか", "移動時間や電車の乗り継ぎ・駐車場の有無が考慮されているか", "予算に沿った目安コスト(交通費、入場料)が算出されているか"]
    },
    "教育": {
      title: "独学者向けの%ITEM%完全マスターカリキュラム",
      details: [
        "文系社会人が3ヶ月で応用情報技術者試験に一発合格するための学習ロードマップ",
        "10歳児が自律的にScratchからPythonへステップアップする15日間計画",
        "音大卒がAIデータサイエンティストへキャリア転換するための数学・プログラミング学習"
      ],
      idealPattern: "学習心理学に基づいたカリキュラム設計。週単位の目標、使用すべき無料・有料リソースの指定、挫折しやすい「難所(ボトルネック)」の特定と対処法、定着度を測るためのアウトプット用演習問題の提示。",
      minPattern: "「教科書を読んで問題を解きましょう」といった、通り一辺倒の当たり前の推奨学習法の提示。",
      ngPattern: "初心者にいきなり最難関の原著や論文を読むよう推奨し、学習意欲を即座に削ぎ落とし挫折させる非効率なカリキュラム。",
      criteriaList: ["週ごとのクリア条件(Milestone)が明記されているか", "学習効果を高めるアウトプット用の具体的な演習内容があるか", "想定される躓きポイントとその具体的な処方箋があるか"]
    },
    "家族": {
      title: "ライフステージの変化に応じた%ITEM%家族マネジメント計画",
      details: [
        "共働き夫婦が家事・育児分担の不満を解消するための「家族マネジメント合意書」",
        "両親の高齢化に伴う、遠隔実家の片付け・実家売却と介護・医療情報の共有設計",
        "子供の教育資金(中学受験)と老後資金を両立させる家計の支出最適化プラン"
      ],
      idealPattern: "感情論を排除し、ロジカルかつ家族愛に基づいた設計。家事の定量的な「可視化(タスク一覧表)」、定例の「家族会議アジェンダ」、法的・資金的なシミュレーション、お互いのプライベート時間確保のための具体的なアロケーションルール。",
      minPattern: "「話し合って仲良く協力しましょう」といった、精神論や綺麗事のみで構成され、具体的な家事分担や予算計画がないもの。",
      ngPattern: "一方の親や特定のメンバーに過度な負担を強いる非対称な役割分担や、家族関係をさらに悪化させる高圧的なルール設計。",
      criteriaList: ["不満を防止するための定量的な可視化(分担割合など)があるか", "定期的な振り返りや改善の仕組み(フィードバックループ)があるか", "緊急時(病気、急用)の対応エスカレーションルールがあるか"]
    },
    "健康": {
      title: "自律神経を整え睡眠効率を最大化する%ITEM%バイオハック設計",
      details: [
        "リモートワークで肩こり・慢性疲労を抱える30代のための2週間リカバリープログラム",
        "交代勤務(夜勤あり)の看護師のための、概日リズム(サーカディアンリズム)調整法",
        "アスリート向けの、心拍変動(HRV)を最適化する高強度インターバルと回復食"
      ],
      idealPattern: "エビデンスベース(最新の臨床研究や生理学、ホルモン分泌サイクル)の介入。光(ブルーライト、日光)の浴び方、食事タイミング、深部体温コントロール、栄養サプリメント(マグネシウム、テアニン等)の摂取指針、効果検証のための各種バイオデータ測定プロトコル。",
      minPattern: "「早寝早起きをして野菜を食べ、よく眠りましょう」といった、健康ポスターレベルの極めて一般的な浅いアドバイス。",
      ngPattern: "医学的根拠のない怪しいサプリの推奨や、健康被害を生じる危険性のある急激な断食・過度な筋トレの推奨。",
      criteriaList: ["光のコントロール(遮光、朝の光など)の時間割があるか", "生理学的なエビデンス(メラトニン、コルチゾール)の解説があるか", "効果測定用のデバイス(スマートウォッチ等)の活用法があるか"]
    },
    "アイデア": {
      title: "既存産業のDXを加速する%ITEM%ブレスト用新規アイデア発想",
      details: [
        "農業×自律ドローンによる、高齢化した果樹園の完全無人収穫システム",
        "メンタルヘルス×AIチャットボットによる、企業の離職率低下ソリューション",
        "地方の空き家×インバウンド観光客による、日本酒体験型分散ホテル"
      ],
      idealPattern: "オズボーンのチェックリストやSCAMPER法を用いたシステマティックなアイデア展開。競合のポジショニング、ビジネスモデルのキャンバス(BMC)、想定する顧客のペイン(Pain)とゲイン(Gain)、差別化となるコア技術の組み合わせが斬新であること。",
      minPattern: "既存の他社サービスをそのままなぞっただけで、新規性や独自の付加価値、テクノロジーの応用が一切ないアイデア。",
      ngPattern: "技術的に不可能なアイデア(永久機関や超能力など)を前提とした、SF的な妄想にとどまるビジネスアイデア。",
      criteriaList: ["発想を広げるフレームワーク(SCAMPER等)の軌跡があるか", "独自の強み(Unique Value Proposition)が明確に言語化されているか", "実用化に向けた最大の技術的・法的なハードルが明記されているか"]
    },
    "意思決定": {
      title: "多面的なリスクを考慮した%ITEM%の戦略的意思決定フレームワーク",
      details: [
        "自社コア事業の海外展開における、国別(ベトナム vs インド)の進出先選定",
        "レガシーシステムの完全刷新か、それとも既存延命かというCTOの究極の選択",
        "スタートアップのシリーズAでの資金調達先(金融機関 vs VC)の戦略的決定"
      ],
      idealPattern: "デシジョンツリー、PROACT法、AHP(階層分析法)などを駆使した意思決定マトリクス。各選択肢の「最悪のシナリオ(Worst Case)」「撤退基準(Trigger for Exit)」「定性的リスクと定量的インパクトの重要度重み付け」を網羅した最高峰の意思決定支援ツール。",
      minPattern: "「メリットとデメリットを並べました。最後は経営陣の直感です」という、分析とは呼べない無責任なまとめ。",
      ngPattern: "致命的なリスク(法的リスク、資金ショートなど)を過小評価し、組織を破滅に導きかねない偏った判断バイアスのある推奨。",
      criteriaList: ["明確な意思決定基準(KGI/KPI)の重み付けがされているか", "最悪の事態を想定した「撤退ルール」が明記されているか", "客観的なトレードオフ(一長一短)がデータと共に議論されているか"]
    }
  };

  let idCounter = 1;

  // Generate 15 missions per category across different difficulties
  // 20 categories * 15 missions = 300 missions!
  VALIDATION_CATEGORIES.forEach((cat) => {
    const template = templates[cat];
    if (!template) return;

    for (let i = 0; i < 15; i++) {
      // Rotate difficulties: Easy, Normal, Hard, Expert, Impossible
      const diff = DIFFICULTIES[i % DIFFICULTIES.length];
      const detail = template.details[i % template.details.length];
      const itemTitle = detail.split("の")[0] || "革新的";

      const finalInput = `${template.title.replace("%ITEM%", itemTitle)}。具体的要望: ${detail}。出力は、最高品質、最低品質、およびNG例のすべての品質要件に耐えられるよう、極めて論理的かつ網羅的に作成してください。`;

      const golden: GoldenAnswer = {
        idealAnswer: `【理想回答】\n${template.idealPattern}\n\n■ 具体例:\n1. 課題の徹底的な構造化\n2. 5つのステップと各エビデンス\n3. ${detail}に対する直接的な最適化アンサー。\nこれで完璧なビジネス・実用価値を提供します。`,
        minQuality: `【最低品質ライン】\n${template.minPattern}\n\n最低限の要件は満たしていますが、深みや個別最適化、リスク予測のパートが著しく不足しています。`,
        ngExample: `【NG例】\n${template.ngPattern}\n\n絶対に避けるべきアプローチ。思考停止の一般論、または非科学的・法律違反のリスクがある記述。`,
        criteria: template.criteriaList.map(c => `${c} (テストケース #${i + 1})`)
      };

      list.push({
        id: `acos-mission-${idCounter.toString().padStart(3, "0")}`,
        category: cat,
        difficulty: diff,
        input: finalInput,
        golden
      });

      idCounter++;
    }
  });

  return list;
}

// ⑤ World Benchmark Comparison Baseline Data
export const INITIAL_WORLD_BENCHMARKS: WorldBenchmarkStats[] = [
  { aiName: "ACOS 2.0 (Proposed)", winRate: 94.8, latencyMs: 1450, qualityScore: 96.5, reliability: 98.8 },
  { aiName: "ChatGPT (GPT-4o)", winRate: 85.2, latencyMs: 1800, qualityScore: 86.0, reliability: 92.5 },
  { aiName: "Claude (3.5 Sonnet)", winRate: 88.5, latencyMs: 2200, qualityScore: 89.4, reliability: 95.0 },
  { aiName: "Gemini (1.5 Pro)", winRate: 86.0, latencyMs: 1600, qualityScore: 85.5, reliability: 93.0 },
  { aiName: "Perplexity (Sonar Pro)", winRate: 82.3, latencyMs: 2400, qualityScore: 82.0, reliability: 89.8 },
  { aiName: "Grok (Beta)", winRate: 78.4, latencyMs: 1950, qualityScore: 77.5, reliability: 86.0 },
  { aiName: "Manus (Autonomous)", winRate: 91.2, latencyMs: 4500, qualityScore: 92.0, reliability: 94.2 },
  { aiName: "OpenRouter (Ensemble)", winRate: 83.5, latencyMs: 2100, qualityScore: 84.0, reliability: 91.5 },
  { aiName: "Future AI (Upcoming)", winRate: 0.0, latencyMs: 0, qualityScore: 0.0, reliability: 0.0 }
];

// ⑥ Weakness Analyzer Init Data
export const INITIAL_WEAKNESSES: WeaknessAnalysis[] = [
  {
    id: "weakness-1",
    analyzedAt: "2026-07-04",
    category: "プログラミング",
    failCount: 8,
    rootCause: "大規模なReactのレンダリング最適化におけるエッジケースで、不要な再レンダリングをトリガーする記述が混入した。",
    improvementPlan: "レンダリングサイクルの静的解析ルールをACOS思考ツリーに強制マッピングし、メモ化とプリミティブな依存配列設定を最適化する。",
    remediationStatus: "In Progress"
  },
  {
    id: "weakness-2",
    analyzedAt: "2026-07-05",
    category: "意思決定",
    failCount: 6,
    rootCause: "不確実性の高い進出先シミュレーションで、最悪ケースの損失額計算がやや楽観的にバイアスしてしまった。",
    improvementPlan: "批判思考エージェントの介入閾値を引き下げ、リスクの加重評価係数を自動的に1.5倍にする監査ステップを挿入。",
    remediationStatus: "Resolved"
  },
  {
    id: "weakness-3",
    analyzedAt: "2026-07-09",
    category: "画像生成",
    failCount: 9,
    rootCause: "Stable Diffusionの特定LoRA・アスペクト比指定において、ネガティブプロンプトの冗長化による画質劣化が一部で確認された。",
    improvementPlan: "プロンプト生成レイヤーをGemini 2.5 Proの「正確性プロンプトビルダー」へアップグレードし、過剰修飾を排して構造的なウェイト調整に変更する。",
    remediationStatus: "Open"
  }
];

// ⑦ Daily Evolution History (Daily comparison)
export const INITIAL_DAILY_EVOLUTION: DailyEvolutionLog[] = [
  { date: "07/04", successRate: 91.2, overallQuality: 92.0, factScore: 93.5, uxScore: 90.1, speedScore: 94.2, improvementRate: 0.0 },
  { date: "07/05", successRate: 92.5, overallQuality: 93.1, factScore: 94.2, uxScore: 91.5, speedScore: 94.0, improvementRate: 1.3 },
  { date: "07/06", successRate: 92.8, overallQuality: 93.5, factScore: 94.5, uxScore: 92.0, speedScore: 94.5, improvementRate: 0.4 },
  { date: "07/07", successRate: 93.4, overallQuality: 94.2, factScore: 95.0, uxScore: 93.2, speedScore: 94.1, improvementRate: 0.7 },
  { date: "07/08", successRate: 94.0, overallQuality: 95.0, factScore: 96.2, uxScore: 94.0, speedScore: 94.8, improvementRate: 0.8 },
  { date: "07/09", successRate: 94.5, overallQuality: 95.8, factScore: 97.0, uxScore: 94.8, speedScore: 95.2, improvementRate: 0.8 },
  { date: "07/10", successRate: 94.8, overallQuality: 96.5, factScore: 97.5, uxScore: 95.5, speedScore: 95.8, improvementRate: 0.7 }
];

// ⑧ Quality Weekly Report Data
export const INITIAL_WEEKLY_REPORTS: QualityWeeklyReport[] = [
  {
    weekId: "W27 (July 1st-7th)",
    generatedAt: "2026-07-07 18:00",
    improvements: [
      "ACOS 2.0 意思決定エンジンをAHP(階層分析法)により高度化。重み付け計算の透明性を95%から98.5%へ向上。",
      "翻訳モジュールのコンテキスト認識力を50kトークン超えドキュメントで再チューニング。文化的ギャップの誤訳率をゼロに。"
    ],
    risks: [
      "プログラミングカテゴリにおけるエッジなRustマクロ構文の一部で、コンパイル時安全評価の遅延時間(予測時間+200ms)を確認。"
    ],
    debts: [
      "一部の複雑な複数ステップワークフローにおける、メモリキャッシュ(V12)の未使用セグメント残留。ガーベッジコレクションの最適化を要す。"
    ],
    qualitySummary: "全カテゴリにおけるゴール到達率(Goal Reach Rate)は平均95.2%を維持。特に文章作成・要約カテゴリでは世界最高得点を連続記録中。",
    averageSpeedMs: 1450,
    satisfactionRate: 99.1
  }
];
