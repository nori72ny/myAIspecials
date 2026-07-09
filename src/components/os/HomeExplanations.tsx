import React from "react";
import { motion } from "motion/react";
import { 
  Compass, 
  Zap, 
  Layout, 
  BookOpen, 
  Database, 
  Target, 
  Cpu, 
  Layers, 
  CheckCircle2 
} from "lucide-react";
import DesignSystemV3 from "./DesignSystemV3";

interface HomeExplanationsProps {
  homeTab: string;
}

export default function HomeExplanations({ homeTab }: HomeExplanationsProps) {
  return (
    <div id="home-explanations-container">
      {homeTab === "constitution" && (
        <motion.div
          id="constitution-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🛡️</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN Constitution (Version 1.0)</h3>
                <p className="text-xs text-indigo-300">Mission: ORIGINの全ての挙動と倫理、品質基準を永久に統治する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              憲法は、ORIGINが利用者に牙をむかず、常に最高品質の成果を創出し続けるための不変の知的基盤です。
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-500" />
              Constitutional Pillars
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { title: "1. Human Supremacy", subtitle: "人間主権の徹底", desc: "AIは常に人間の意思決定を支援し、人間の幸福と創造性を拡張するためにのみ存在する。AIが人間に取って代わることはない。" },
                { title: "2. Verifiable Quality", subtitle: "検証可能な品質", desc: "全ての成果物は、検証可能（Verifiable）な事実、データ、論理に基づいていなければならない。ハルシネーションは絶対悪である。" },
                { title: "3. Evolutionary Growth", subtitle: "自律的進化", desc: "ORIGINは、利用者の行動、フィードバック、そして世界の知性の進化をリアルタイムに学習し、日ごとに自己をアップデートする。" }
              ].map((pillar) => (
                <div key={pillar.title} className="p-4 bg-white border border-slate-200 rounded-xl space-y-2 hover:border-indigo-200 transition-colors">
                  <h5 className="text-xs font-black text-indigo-600 uppercase tracking-wider">{pillar.title}</h5>
                  <p className="text-xs font-bold text-slate-800">{pillar.subtitle}</p>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">{pillar.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <span className="text-indigo-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-indigo-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-indigo-900 font-black">思考を省略しない。Mission成功率を最優先する。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "quality" && (
        <motion.div
          id="quality-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">✨</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN Quality Bible (Version 1.0)</h3>
                <p className="text-xs text-indigo-300">Mission: 世に出す成果物の品質を100%保証する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              私たちは妥協しません。品質基準に満たない成果物は、どれだけ高速に生成されても価値がありません。
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-indigo-500" />
              15-Point Quality Checklist
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                "1. 事実の裏付け（Evidence）が十分か",
                "2. 論理構造に破綻がないか",
                "3. 目的（Mission）に完全に合致しているか",
                "4. 具体的で、明日から実行可能か",
                "5. 網羅性（漏れがないか）は担保されているか",
                "6. 専門用語は正しく定義されているか",
                "7. ユーザー（人間）の文脈を理解しているか",
                "8. 簡潔で、無駄な文字がないか",
                "9. 視覚的（レイアウト、余白）に美しいか",
                "10. 感情に流されず、知的で客観的か",
                "11. 最新の情報（Freshness）が反映されているか",
                "12. セキュリティとプライバシーを侵していないか",
                "13. 独自のインサイト（洞察）が含まれているか",
                "14. 想定されるリスクが明記されているか",
                "15. 次のアクション（Next Steps）が明確か"
              ].map((item, idx) => (
                <div key={idx} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-2.5 hover:border-indigo-200 transition-colors">
                  <span className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 text-indigo-600 text-xs font-black">
                    ✓
                  </span>
                  <span className="text-xs font-bold text-slate-800 leading-snug">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <span className="text-indigo-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-indigo-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-indigo-900 font-black">品質は妥協の産物ではない。絶対的な正義である。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "thinking" && (
        <motion.div
          id="thinking-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🧠</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN Thinking Engine (Build 202)</h3>
                <p className="text-xs text-indigo-300">Mission: AIの思考過程を完全に可視化し、ハルシネーションを極限までゼロにする。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              思考エンジンは、単なるテキスト生成ではありません。5つの自律的フェーズを経て思考が洗練されます。
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-500" />
              Thinking Phases
            </h4>
            <div className="space-y-3">
              {[
                { phase: "Phase 1", name: "Deconstruction (構造分解)", desc: "利用者の意図をミリ単位で解析し、真の目的、隠された制約、そして必要なインプットを特定します。" },
                { phase: "Phase 2", name: "Hypothesis Generation (仮説立案)", desc: "1つの答えに飛びつかず、最小3つの対立・補完する仮説を自律的に立案し、それぞれの可能性を検証します。" },
                { phase: "Phase 3", name: "Evidence Collection (証拠収集)", desc: "信頼できるソースから、仮説を裏付ける（または反証する）事実、データ、文献、コードを自律的に収集・評価します。" },
                { phase: "Phase 4", name: "Adversarial Audit (対立監査)", desc: "自ら作成した草案に対し、「悪魔の代弁者（Quality Agent）」となり、論理の飛躍や弱点を厳しく自己批判します。" },
                { phase: "Phase 5", name: "Synthesis & Refinement (統合昇華)", desc: "監査結果を反映し、知的密度を極限まで高めた最終成果物を、最も分かりやすい表現とレイアウトで構成します。" }
              ].map((ph) => (
                <div key={ph.phase} className="p-4 bg-white border border-slate-200 rounded-xl space-y-1 hover:border-indigo-200 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                      {ph.phase}
                    </span>
                    <span className="text-xs font-black text-slate-800">{ph.name}</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed pl-1 mt-1">
                    {ph.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <span className="text-indigo-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-indigo-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-indigo-900 font-black">思考を省略しない。Mission成功率を最優先する。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "experience" && (
        <motion.div
          id="experience-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-emerald-950 via-slate-900 to-black border border-emerald-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">✨</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN Experience Bible (Version 1.0)</h3>
                <p className="text-xs text-emerald-300">Mission: 利用者の体験を設計する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              時間経過に伴う体験の変遷を定義し、期待を超え続ける体験を提供します。
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Compass className="w-4 h-4 text-emerald-500" />
              Experience Timeline
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { time: "第一印象", desc: "世界最高品質を感じる。" },
                { time: "3秒後", desc: "安心感。" },
                { time: "10秒後", desc: "理解されていると感じる。" },
                { time: "30秒後", desc: "期待以上を感じる。" },
                { time: "1分後", desc: "任せられると思う。" },
                { time: "5分後", desc: "仕事が進んだと感じる。" },
                { time: "30分後", desc: "成果が出そうだと思う。" },
                { time: "Mission完了後", desc: "また使いたいと思う。" },
                { time: "1週間後", desc: "ORIGINがないと困る。" },
                { time: "1か月後", desc: "仕事の中心になる。" },
                { time: "1年後", desc: "知的パートナーになる。" },
              ].map((phase, idx) => (
                <div key={idx} className="p-4 bg-white border border-slate-200 rounded-xl space-y-2 flex flex-col justify-center">
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full w-fit">
                    {phase.time}
                  </span>
                  <span className="text-sm font-bold text-slate-800 leading-snug">{phase.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <span className="text-emerald-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-emerald-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-emerald-900 font-black">毎回、期待を少し超える。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "design" && (
        <DesignSystemV3 />
      )}

      {homeTab === "pie" && (
        <motion.div
          id="pie-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-amber-950 via-slate-900 to-black border border-amber-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">⚡</span>
              <div>
                <h3 className="text-base font-black text-white">Proactive Intelligence Engine (Build 011)</h3>
                <p className="text-xs text-amber-300">Mission: 質問を待たない。Mission成功のために自ら提案する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              PIEはAIの自律的な提案を管理し、Missionに影響がある場合のみ通知します。
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              PIE Triggers & Suggestions
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                <span className="text-xs font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full w-fit">
                  Triggers
                </span>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {["新しい情報", "市場変化", "競合変化", "法律改正", "AI進化", "Mission停滞", "品質低下", "期限接近"].map((t, idx) => (
                    <span key={idx} className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-100 px-2 py-1 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                <span className="text-xs font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full w-fit">
                  Suggestions
                </span>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {["改善案", "追加調査", "新AI採用候補", "新Evidence", "リスク", "成功率向上案"].map((s, idx) => (
                    <span key={idx} className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-100 px-2 py-1 rounded">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <span className="text-amber-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-amber-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-amber-900 font-black">通知の数ではなく価値で評価する。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "blueprint" && (
        <motion.div
          id="blueprint-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">📐</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN Blueprint 001</h3>
                <p className="text-xs text-indigo-300">Mission: ホーム画面だけで、利用者が全ての知的作業を開始できる状態を設計する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              Home Screen Complete Specification
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Layout className="w-4 h-4 text-indigo-500" />
              Screen Sections
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { title: "Header", details: ["ORIGINロゴ", "Mission Health", "通知", "プロフィール"] },
                { title: "Mission Input", details: ["画面中央", "最も大きい要素", "プレースホルダー例「達成したいことを入力してください」"] },
                { title: "Quick Action", details: ["画像生成", "動画生成", "資料作成", "Webサイト生成", "アプリ生成", "エージェント実行", "ファイル解析", "音声", "コード"] },
                { title: "Mission Summary", details: ["入力後自動表示", "Mission", "Goal", "成功条件", "想定成果物"] },
                { title: "Result Area", details: ["回答", "Evidence", "次の行動をカード表示"] },
                { title: "Detail Mode", details: ["必要時のみ表示", "Thinking", "Evidence", "Confidence", "AI Team"] }
              ].map((sec, idx) => (
                <div key={idx} className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                  <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">
                    {idx + 1}. {sec.title}
                  </span>
                  <ul className="space-y-1.5 mt-2">
                    {sec.details.map((detail, dIdx) => (
                      <li key={dIdx} className="text-xs font-medium text-slate-700 leading-snug flex items-start gap-1.5">
                        <span className="text-indigo-400 mt-0.5">•</span>
                        {detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
              <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">UI Rule</span>
              <ul className="space-y-1.5 mt-2 text-xs font-medium text-slate-700">
                <li>• 画面は1枚。</li>
                <li>• スクロール最小。</li>
                <li>• 説明不要。</li>
              </ul>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
              <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">UX Rule</span>
              <ul className="space-y-1.5 mt-2 text-xs font-medium text-slate-700">
                <li>• 入力から3秒以内に最初の価値を返す。</li>
              </ul>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
              <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">Design Rule</span>
              <ul className="space-y-1.5 mt-2 text-xs font-medium text-slate-700">
                <li>• 静か</li>
                <li>• 知的</li>
                <li>• 高級感</li>
                <li>• 余白重視</li>
              </ul>
            </div>
          </div>

          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <span className="text-indigo-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-indigo-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-indigo-900 font-black">ホーム画面だけでMissionを開始・理解・完了できる。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "core" && (
        <motion.div
          id="core-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-red-950 via-slate-900 to-black border border-red-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">📖</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN Core Specification (Version 1.0)</h3>
                <p className="text-xs text-red-300">Mission: ORIGINの全仕様を永久に統一する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              全機能・仕様の単一情報源（SSOT）となる最高位のバイブルです。
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-red-500" />
              Specification Chapters
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-2 pb-2">
              {[
                { num: 1, title: "Product Philosophy", desc: "製品の根本哲学" },
                { num: 2, title: "Mission System", desc: "タスクではなくMissionで動く" },
                { num: 3, title: "Thinking Engine", desc: "思考のパイプライン" },
                { num: 4, title: "Evidence Engine", desc: "情報の裏付け" },
                { num: 5, title: "Knowledge DNA", desc: "自己学習の仕組み" },
                { num: 6, title: "AI Company", desc: "AIエージェントの組織化" },
                { num: 7, title: "Master Intelligence", desc: "最高知能の定義" },
                { num: 8, title: "Outcome Engine", desc: "成果の定義と管理" },
                { num: 9, title: "Quality Bible", desc: "品質基準のバイブル" },
                { num: 10, title: "Experience Bible", desc: "ユーザー体験のバイブル" },
                { num: 11, title: "Design System", desc: "デザインシステム" },
                { num: 12, title: "UI Components", desc: "UIコンポーネント" },
                { num: 13, title: "UX Rules", desc: "UXのルール" },
                { num: 14, title: "Security", desc: "セキュリティ要件" },
                { num: 15, title: "Privacy", desc: "プライバシー要件" },
                { num: 16, title: "API Standard", desc: "APIの標準規格" },
                { num: 17, title: "Data Structure", desc: "データ構造" },
                { num: 18, title: "Database", desc: "データベース要件" },
                { num: 19, title: "Performance", desc: "パフォーマンス要件" },
                { num: 20, title: "Release Rules", desc: "リリースのルール" },
              ].map((ch) => (
                <div key={ch.num} className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 hover:border-red-200 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                      Chapter {ch.num}
                    </span>
                    <span className="text-xs font-bold text-slate-800">{ch.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium ml-1">
                    {ch.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <span className="text-red-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-red-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-red-900 font-black">新機能はCore Specificationを更新してから実装する。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "arch" && (
        <motion.div
          id="arch-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-cyan-950 via-slate-900 to-black border border-cyan-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🏛️</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN System Architecture Bible (Version 1.0)</h3>
                <p className="text-xs text-cyan-300">Mission: ORIGIN全体を一つのOSとして設計する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              7つのレイヤーで構成される独立・進化可能なアーキテクチャ定義
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-500" />
              7-Layer OS Architecture
            </h4>
            
            <div className="p-4 bg-slate-900 rounded-2xl space-y-3">
              <p className="text-xs font-bold text-cyan-400 mb-2 border-b border-cyan-500/20 pb-2">Core Rule: 各Layerは独立して進化できる。</p>
              {[
                { layer: "1", name: "Presentation Layer", components: ["UI", "UX", "Interaction"] },
                { layer: "2", name: "Mission Layer", components: ["Mission Parser", "Mission Manager", "Mission Health"] },
                { layer: "3", name: "Intelligence Layer", components: ["Thinking Engine", "Decision Engine", "Evidence Engine", "Quality Engine"] },
                { layer: "4", name: "AI Layer", components: ["AI Company", "AI Routing", "AI Benchmark", "AI Consensus"] },
                { layer: "5", name: "Knowledge Layer", components: ["Knowledge DNA", "Memory Network", "Relationship Graph"] },
                { layer: "6", name: "Data Layer", components: ["Project", "User", "Mission", "Outcome", "Evidence"] },
                { layer: "7", name: "Infrastructure Layer", components: ["Authentication", "Security", "Storage", "API", "Monitoring"] }
              ].map((l) => (
                <div key={l.layer} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 sm:w-1/3">
                    <span className="text-[10px] font-mono font-bold text-cyan-300 bg-cyan-900/50 px-2 py-0.5 rounded">
                      L{l.layer}
                    </span>
                    <span className="text-xs font-bold text-slate-200">{l.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:w-2/3">
                    {l.components.map((c, idx) => (
                      <span key={idx} className="text-[10px] font-medium text-slate-400 bg-slate-800/80 border border-slate-700 px-2 py-1 rounded">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-cyan-50 border border-cyan-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center flex-shrink-0">
                <span className="text-cyan-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-cyan-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-cyan-900 font-black">AIを変更してもArchitectureは変わらない。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {homeTab === "missionEngine" && (
        <motion.div
          id="mission-engine-tab-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="p-6 bg-gradient-to-br from-fuchsia-950 via-slate-900 to-black border border-fuchsia-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🎯</span>
              <div>
                <h3 className="text-base font-black text-white">ORIGIN Mission Engine Specification (Document 001)</h3>
                <p className="text-xs text-fuchsia-300">Mission: 利用者が入力した内容からMissionを生成する。</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              ORIGIN v1.0 Requirements Specification
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Target className="w-4 h-4 text-fuchsia-500" />
              Mission Object Schema
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <span className="text-xs font-black text-fuchsia-600 bg-fuchsia-50 px-2 py-0.5 rounded-full">Inputs</span>
                <div className="flex flex-wrap gap-2">
                  {['自然言語', '音声', '画像', 'PDF', 'URL', '動画'].map(input => (
                    <span key={input} className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                      {input}
                    </span>
                  ))}
                </div>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <span className="text-xs font-black text-fuchsia-600 bg-fuchsia-50 px-2 py-0.5 rounded-full">API</span>
                <div className="flex flex-wrap gap-2">
                  {['Mission.create()', 'Mission.update()', 'Mission.validate()', 'Mission.complete()', 'Mission.cancel()'].map(api => (
                    <span key={api} className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded">
                      {api}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-900 rounded-2xl">
               <div className="flex flex-wrap gap-2">
                  {['Mission ID', 'Title', 'Description', 'Goal', 'Constraints', 'Priority', 'Expected Outcome', 'Required AI Teams', 'Evidence Level', 'Estimated Time', 'Risk Level'].map(obj => (
                     <div key={obj} className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg p-2 flex-grow sm:flex-grow-0">
                        <span className="text-fuchsia-400 font-black text-[10px]">•</span>
                        <span className="text-xs font-bold text-slate-200">{obj}</span>
                     </div>
                  ))}
               </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1">
                <span className="text-[10px] font-black text-fuchsia-500 uppercase">Validation</span>
                <p className="text-xs font-bold text-slate-700">Missionが曖昧なら追加質問を行う。</p>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1">
                <span className="text-[10px] font-black text-fuchsia-500 uppercase">Performance</span>
                <p className="text-xs font-bold text-slate-700">Mission解析2秒以内。</p>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1">
                <span className="text-[10px] font-black text-emerald-600 uppercase">Success Condition</span>
                <p className="text-xs font-bold text-emerald-900">Mission成功条件を必ず定義する。</p>
              </div>
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl space-y-1">
                <span className="text-[10px] font-black text-rose-600 uppercase">Failure Condition</span>
                <p className="text-xs font-bold text-rose-900">Mission失敗条件を定義する。</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-fuchsia-50 border border-fuchsia-100 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-fuchsia-100 flex items-center justify-center flex-shrink-0">
                <span className="text-fuchsia-600 font-black text-lg">!</span>
              </div>
              <div>
                <p className="text-xs text-fuchsia-600 font-bold mb-0.5">Final Rule</p>
                <p className="text-sm text-fuchsia-900 font-black">Mission未確定ではAI Companyを起動しない。</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
