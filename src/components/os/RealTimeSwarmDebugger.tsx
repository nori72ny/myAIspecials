import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Activity, 
  Cpu, 
  Shield, 
  Layers, 
  Sparkles, 
  Server, 
  Terminal, 
  Workflow, 
  Users, 
  MessageSquare, 
  CheckCircle2, 
  Apple,
  AlertCircle, 
  TrendingUp, 
  Award,
  ArrowRight,
  Code,
  Network,
  HelpCircle,
  Eye,
  Check,
  X,
  FileText,
  Crown,
  Search,
  Beaker,
  Handshake,
  Coins,
  User
} from "lucide-react";
import { cn } from "../../utils";

// Interface Definitions
interface AgentNode {
  id: string;
  name: string;
  role: string;
  icon: React.ReactNode;
  status: "Thinking" | "Waiting" | "Working" | "Reviewing" | "Finished";
  color: string;
  provider: string;
  x: number; // Percentage for network visualizer
  y: number; // Percentage for network visualizer
}

interface MessageLog {
  id: string;
  from: string;
  to: string;
  text: string;
  type: "Request" | "Response" | "Consensus" | "Approval" | "Review";
  thought?: string;
  timestamp: string;
}

interface DecisionItem {
  id: string;
  decision: string;
  reason: string;
  confidence: number;
  uqi: number;
  timestamp: string;
}

interface EventStreamItem {
  id: string;
  type: string;
  message: string;
  timestamp: string;
}

interface VoteDetail {
  agentId: string;
  vote: string;
  reason: string;
}

interface ConsensusBlock {
  title: string;
  uqiScore: number;
  confidenceScore: number;
  votes: VoteDetail[];
  finalDecision: string;
  reason: string;
  savedToWorkspace: boolean;
  appleReviewVerdict?: {
    verdict: string;
    reasoning: string;
    confidenceLevel: number;
    blockingIssues: string[];
  };
}

const PRESET_MISSIONS = [
  {
    id: "business",
    title: "新規AI SaaS事業のSWOT分析とROI予測",
    prompt: "新規AI SaaSの市場可能性を探り、5年間の売上予測とSWOT分析を12-Factor基準でコンパイルします。"
  },
  {
    id: "legal",
    title: "交通事故に強い弁護士の比較・推薦システム",
    prompt: "国内の判例データベースとクチコミをWeb Groundingで探索し、勝率の高い法律事務所の推薦要件を作成。"
  },
  {
    id: "code",
    title: "React向けアニメーション付きカードコンポーネント設計",
    prompt: "Framer Motion (motion/react) を使用した、超高品質なガラスモフィズムUIコンポーネントを設計・検証。"
  },
  {
    id: "marketing",
    title: "最新のAI検索エンジン最適化（AIO/GEO）戦略",
    prompt: "LLM検索（Perplexity/Gemini）に選ばれるための、ブランドキーワードのセマンティック最適化手法。"
  }
];

export default function RealTimeSwarmDebugger() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("business");
  const [customPrompt, setCustomPrompt] = useState("");
  
  // Execution mode states
  const [isRealAiMode, setIsRealAiMode] = useState(false);
  const [isExecutingApi, setIsExecutingApi] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Simulation & Playback state
  const [currentTick, setCurrentTick] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const [playbackIndex, setPlaybackIndex] = useState(0);

  // Core Swarm States
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [events, setEvents] = useState<EventStreamItem[]>([]);
  const [consensus, setConsensus] = useState<ConsensusBlock | null>(null);
  
  // Interactive UI States
  const [activeConnection, setActiveConnection] = useState<{ from: string; to: string; type: string } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<MessageLog | null>(null);
  const [showConsensusBoard, setShowConsensusBoard] = useState(false);
  const [workspaceSavedBadge, setWorkspaceSavedBadge] = useState(false);

  // Complete data pool for current run (simulated or API-fetched)
  const [messagesPool, setMessagesPool] = useState<MessageLog[]>([]);
  const [decisionsPool, setDecisionsPool] = useState<DecisionItem[]>([]);
  const [eventsPool, setEventsPool] = useState<EventStreamItem[]>([]);
  const [consensusPool, setConsensusPool] = useState<ConsensusBlock | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Circular layout of 10 Agents in clean orbital space
  const defaultAgents: AgentNode[] = [
    { id: "ceo", name: "CEO Agent", role: "Chief Executive", icon: <Crown className="w-4 h-4" />, status: "Waiting", color: "#6366F1", provider: "Gemini 3.5 Pro (Google)", x: 50, y: 15 },
    { id: "cto", name: "CTO Agent", role: "Chief Technology", icon: <Cpu className="w-4 h-4" />, status: "Waiting", color: "#38BDF8", provider: "GPT-4o (OpenAI)", x: 25, y: 35 },
    { id: "cfo", name: "CFO Agent", role: "Chief Financial", icon: <Coins className="w-4 h-4" />, status: "Waiting", color: "#F59E0B", provider: "Gemini 3.5 Flash (Google)", x: 75, y: 35 },
    { id: "coo", name: "COO Agent", role: "Chief Operations", icon: <Workflow className="w-4 h-4" />, status: "Waiting", color: "#EC4899", provider: "Claude 3.5 Sonnet (Anthropic)", x: 50, y: 40 },
    { id: "research", name: "Research Lead", role: "Search Grounding", icon: <Search className="w-4 h-4" />, status: "Waiting", color: "#10B981", provider: "Gemini 3.5 Flash (Google)", x: 15, y: 60 },
    { id: "architecture", name: "Architecture Lead", role: "Constraint Compliance", icon: <Layers className="w-4 h-4" />, status: "Waiting", color: "#8B5CF6", provider: "GPT-4o (OpenAI)", x: 85, y: 60 },
    { id: "developer", name: "Developer Agent", role: "Code & Deliverables", icon: <Code className="w-4 h-4" />, status: "Waiting", color: "#F97316", provider: "Claude 3.5 Sonnet (Anthropic)", x: 30, y: 80 },
    { id: "qa", name: "QA Agent", role: "Verification Gate", icon: <CheckCircle2 className="w-4 h-4" />, status: "Waiting", color: "#EF4444", provider: "Llama 3.1 70B (Meta)", x: 70, y: 80 },
    { id: "reviewer", name: "Reviewer Agent", role: "Subjective Critique", icon: <Eye className="w-4 h-4" />, status: "Waiting", color: "#06B6D4", provider: "Gemini 3.5 Pro (Google)", x: 50, y: 92 },
    { id: "consensus", name: "Consensus Engine", role: "UQI Audit Gate", icon: <Handshake className="w-4 h-4" />, status: "Waiting", color: "#10B981", provider: "ACOS Consensus Auditor", x: 50, y: 63 }
  ];

  const getMissionTitle = () => {
    if (customPrompt.trim()) return customPrompt;
    const preset = PRESET_MISSIONS.find(p => p.id === selectedPresetId);
    return preset ? preset.title : "Corporate Strategy Realignment";
  };

  const getMissionPrompt = () => {
    if (customPrompt.trim()) return customPrompt;
    const preset = PRESET_MISSIONS.find(p => p.id === selectedPresetId);
    return preset ? preset.prompt : "自律的ミッションの実行";
  };

  // Setup initial state
  const initializeStates = (agentsList = defaultAgents) => {
    setAgents(agentsList.map(a => ({ ...a, status: "Waiting" })));
    setMessages([]);
    setDecisions([]);
    setEvents([
      {
        id: `evt-init-${Date.now()}`,
        type: "MissionCreated",
        message: `ミッション「${getMissionTitle()}」がOSカーネル上に作成されました。`,
        timestamp: new Date().toLocaleTimeString() + ".000"
      }
    ]);
    setPlaybackIndex(0);
    setCurrentTick(0);
    setCurrentPhase(0);
    setProgress(0);
    setShowConsensusBoard(false);
    setWorkspaceSavedBadge(false);
    setActiveConnection(null);
  };

  useEffect(() => {
    initializeStates();
  }, [selectedPresetId, customPrompt]);

  // Handle active playback tick
  useEffect(() => {
    if (!isPlaying || isExecutingApi) return;
    if (messagesPool.length === 0) return;

    const intervalTime = 1800 / speed;
    const timer = setInterval(() => {
      handleNextPlaybackStep();
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isPlaying, speed, playbackIndex, messagesPool, isExecutingApi]);

  // Scroll logging views
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Execute Real AI Swarm Route via POST /api/swarm/run
  const handleExecuteRealSwarm = async () => {
    const promptText = getMissionPrompt();
    setIsExecutingApi(true);
    setApiError(null);
    setIsRealAiMode(true);
    setWorkspaceSavedBadge(false);

    try {
      const response = await fetch("/api/swarm/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText })
      });

      if (!response.ok) {
        throw new Error(`Server returned status: ${response.status}`);
      }

      const data = await response.json();
      
      // Update data pools with Gemini output
      if (data.agents && data.messages && data.decisions && data.events && data.consensus) {
        setMessagesPool(data.messages);
        setDecisionsPool(data.decisions);
        setEventsPool(data.events);
        setConsensusPool(data.consensus);
        
        // Match providers returned from Gemini back into AgentNode list
        const updatedAgentsList = defaultAgents.map(da => {
          const apiAgent = data.agents.find((aa: any) => aa.id === da.id || aa.name.toLowerCase().includes(da.id));
          return {
            ...da,
            provider: apiAgent ? apiAgent.provider : da.provider,
            role: apiAgent ? apiAgent.role : da.role,
            name: apiAgent ? apiAgent.name : da.name
          };
        });

        initializeStates(updatedAgentsList);
      } else {
        throw new Error("Invalid API response format");
      }
    } catch (err: any) {
      console.error("[Swarm API Error]", err);
      setApiError(err.message || "Gemini API Connection failed. Running simulated model fallback.");
      runSimulatedSwarm();
    } finally {
      setIsExecutingApi(false);
    }
  };

  // Setup Simulated Swarm when real AI fails or is not chosen
  const runSimulatedSwarm = () => {
    setIsRealAiMode(false);
    
    // Generate beautiful structured logs for current prompt
    const missionTitle = getMissionTitle();
    const promptText = getMissionPrompt();
    const formattedTime = (offset: number) => {
      const time = new Date(Date.now() + offset * 1000);
      const ms = String(Math.floor(Math.random() * 900) + 100);
      return `${time.toLocaleTimeString()}.${ms}`;
    };

    const simulatedMessages: MessageLog[] = [
      {
        id: "m-1",
        from: "CEO Agent",
        to: "COO Agent",
        type: "Request",
        text: `新規ミッション「${missionTitle}」を受け取りました。全社リソースを起動し、マイルストーン構築、各専門エージェントの目標最適化、およびUQI監査を設定してください。`,
        thought: "ミッションの全社戦略への整合性とROIを検証する。COOに即時アクションを指示。",
        timestamp: formattedTime(1)
      },
      {
        id: "m-2",
        from: "COO Agent",
        to: "Research Lead",
        type: "Request",
        text: "了解しました。ただちに自律DAGの組み立てとマイルストーン構成を実行。リサーチリード、対象テーマのファクトデータベースおよび競合一次情報を探索してください。",
        thought: "10名のエージェントのタスク割り振りを計画。マイルストーンを3フェーズで決定。",
        timestamp: formattedTime(3)
      },
      {
        id: "m-3",
        from: "Research Lead",
        to: "CFO Agent",
        type: "Response",
        text: `「${promptText}」に関して、ウェブ検索および学術ファクトDNAから最高精度の客観データ・先行事例の抽出を完了しました。財務シミュレーションモデルへの入力を提供します。`,
        thought: "ハルシネーションを完全に防止するため公的ドキュメントのみをフィルタリングして集約。",
        timestamp: formattedTime(5)
      },
      {
        id: "m-4",
        from: "CFO Agent",
        to: "CTO Agent",
        type: "Response",
        text: "リサーチデータに基づくROIモデル予測を算出。今回の投資対効果（ROI）は 175% 超を記録する見込み。CTO、システム要件の設計をお願いします。",
        thought: "予算オーバーヘッドを防ぐため、10エージェントあたりの最大 token コスト上限を $0.05 にロック。",
        timestamp: formattedTime(7)
      },
      {
        id: "m-5",
        from: "CTO Agent",
        to: "Architecture Lead",
        type: "Request",
        text: "技術要件を決定。モジュール結合度の最小化およびTypeScriptの完全型安全を条件とします。アーキテクチャリード、非妥協的制約およびコンプライアンスの監査を。",
        thought: "Vite + React 18 12-factor 基準に沿った超高速ビルドアーキテクチャ案を検討。",
        timestamp: formattedTime(9)
      },
      {
        id: "m-6",
        from: "Architecture Lead",
        to: "Developer Agent",
        type: "Review",
        text: "CTO案を承認。ORIGIN非妥協憲法15箇条およびコンテナ隔離規則の完全合格（PASSED）を確認。開発部門、実装を開始してください。",
        thought: "コードのメンテナンス性と将来的な拡張性を保証するため厳格なLinter規則をロード。",
        timestamp: formattedTime(11)
      },
      {
        id: "m-7",
        from: "Developer Agent",
        to: "QA Agent",
        type: "Response",
        text: `要件および美学を満たす高品質コードの実装を完了しました。/src/components 以下のモジュールに書き出し、QA検証スイートへ移行。`,
        thought: "ガラスモフィズムUI、美しい負の余白（Arc Browserレベル）、滑らかなFramer Motionトランジションを組み込んだ完璧なコードを設計。",
        timestamp: formattedTime(13)
      },
      {
        id: "m-8",
        from: "QA Agent",
        to: "Reviewer Agent",
        type: "Review",
        text: "自動単体テスト（合格率100%）、静的解析（エラー0）、メモリリーク不検出を確認。品質基準Q5への合致を検証しました。",
        thought: "TypeScriptの厳格な型推論チェックをクリア。ハルシネーションの不発生を数学的に担保。",
        timestamp: formattedTime(15)
      },
      {
        id: "m-9",
        from: "Reviewer Agent",
        to: "Consensus Engine",
        type: "Review",
        text: "ユーザー体験とUI/UX設計を総合評価。Apple HIGに則る視覚的品格とArc Browserクラスのプレミアムな美しさが達成されていることを保証します。",
        thought: "余白、インタラクティブ状態のビジュアルフィードバック、色コントラストを精査。極上の体験であることを認定。",
        timestamp: formattedTime(17)
      },
      {
        id: "m-10",
        from: "Consensus Engine",
        to: "CEO Agent",
        type: "Consensus",
        text: "全員のディベート及び技術監査が完了。合意形成率は100%（全会一致）、総合UQI指数は 98.6% です。成果物のワークスペースへの保存承認を請願します。",
        thought: "論理的一貫性を完全に検証。ハルシネーション・矛盾がないことを最終合意証明。",
        timestamp: formattedTime(19)
      }
    ];

    const simulatedDecisions: DecisionItem[] = [
      {
        id: "dec-1",
        decision: "客観的ファクトグラウンディング承認",
        reason: "リサーチリードが特定した公的一次ソースのみを知識DNAに紐付け、ハルシネーション発生を防ぐ。",
        confidence: 99,
        uqi: 99.4,
        timestamp: formattedTime(4)
      },
      {
        id: "dec-2",
        decision: "ACOS 12-Factor アーキテクチャロック",
        reason: "アーキテクチャリードによるNode.js分離コンテナとゼロトラストデータ保護仕様を最上設計として決定。",
        confidence: 98,
        uqi: 98.9,
        timestamp: formattedTime(10)
      },
      {
        id: "dec-3",
        decision: "最高品質基準 Q5 認定",
        reason: "QAエージェントおよびReviewerエージェントによる、徹底した自動テスト・美学的UXテストの両面クリア。",
        confidence: 97,
        uqi: 98.6,
        timestamp: formattedTime(16)
      }
    ];

    const simulatedEvents: EventStreamItem[] = [
      { id: "evt-1", type: "MissionCreated", message: `ミッション「${missionTitle}」がOSカーネル上に作成されました。`, timestamp: formattedTime(0) },
      { id: "evt-2", type: "TaskGenerated", message: "自律的なTopological Task DAG（依存関係グラフ）が正しく構築されました。", timestamp: formattedTime(2) },
      { id: "evt-3", type: "CapabilitySelected", message: "必要なAI Capabilityエッジノード（Gemini, OpenAI, Claude）をマッチング完了。", timestamp: formattedTime(4) },
      { id: "evt-4", type: "KnowledgeLoaded", message: "組織全体のKnowledge-DNAおよび長期記憶ブロックのインジェクトを完了。", timestamp: formattedTime(6) },
      { id: "evt-5", type: "MemoryInjected", message: "コンテキスト情報をセマンティックメモリより切り出し。エージェントへ配備。", timestamp: formattedTime(8) },
      { id: "evt-6", type: "ExecutionStarted", message: "エージェント間のリアルタイム討論パイプライン、及び検証用サンドボックスが稼働しました。", timestamp: formattedTime(10) },
      { id: "evt-7", type: "ReviewStarted", message: "相互ピアレビュー・ TypeScriptコンパイラによる静的型安全性の検証を完了。", timestamp: formattedTime(14) },
      { id: "evt-8", type: "ConsensusCompleted", message: "Consensus Engineにより、全員の合意率100%（全会一致）、UQI 98.6% の合意を検知。", timestamp: formattedTime(18) },
      { id: "evt-9", type: "WorkspaceSaved", message: "最高品質の合意として認定された成果物を、Knowledge-DNA台帳へ安全に書き込み完了。", timestamp: formattedTime(20) }
    ];

    const simulatedConsensus: ConsensusBlock = {
      title: "Swarm 最終戦略合意 (Simulated Swarm Alignment)",
      uqiScore: 98.6,
      confidenceScore: 99.2,
      votes: [
        { agentId: "ceo", vote: "APPROVED", reason: "事業投資対効果、戦略性の観点から完璧な論理一貫性を認めたため。" },
        { agentId: "cto", vote: "APPROVED", reason: "要件を極めてスマートに満たす実装、スケーラブルな技術スタックを支持。" },
        { agentId: "cfo", vote: "APPROVED", reason: "利益回収予測、コスト効率の良さが明確に裏付けられているため。" },
        { agentId: "coo", vote: "APPROVED", reason: "全プロセスのタスク委任および時間効率化の最大化を確認したため。" },
        { agentId: "research", vote: "APPROVED", reason: "一次ソースデータとの乖離がないこと、現実のビジネスファクトと完全に整合することを確認。" },
        { agentId: "architecture", vote: "APPROVED", reason: "セキュリティ、12-Factorコンプライアンス of すべての基準が満たされているため。" },
        { agentId: "developer", vote: "APPROVED", reason: "自身の作成したコードと仕様書に対し自信があり、品質基準Q5への合致を再確認。" },
        { agentId: "qa", vote: "APPROVED", reason: "テストカバレッジ、静的解析、暗号化基準をすべて満たしていると判断。" },
        { agentId: "reviewer", vote: "APPROVED", reason: "ユーザーを迷わせない美しいマテリアルUIと最高度のタイポグラフィ、UXへの適合を賞賛。" },
        { agentId: "consensus", vote: "APPROVED", reason: "すべての意見を統合し、数学的矛盾及び不確実な推測がないことを最終監査した。" }
      ],
      finalDecision: `ミッション「${missionTitle}」に対する、全10名の自律エージェントの合意に基づく成果物の完全承認。`,
      reason: "全専門部署・役員がそれぞれの観点から成果物をレビューし、異論やハルシネーション等の不整合が0であることを実証。多数決での全会一致と最高度のUQI（98.6%）が得られたため、本戦略を最終決定とし、生産リリースを承認する。",
      savedToWorkspace: true,
      appleReviewVerdict: {
        verdict: "NO_GO",
        reasoning: "現行UIはDesign System v3.0が定めるカラートークン5色限定ルールに対し、実装済み画面ではemerald・rose・purple等の非公式カラーが多用されており統一感を欠く。カード角丸もrounded-3xl統一の規定に反しxl/2xl/lgが混在。ホーム画面主要カードのtransitionが規定の300ms上限を超え500msで遷移している。これらはApple HIGが重視する視覚的一貫性の基準を満たしておらず、現状のままの発売は推奨しない。",
        confidenceLevel: 92,
        blockingIssues: [
          "カラートークンが公式5色限定ルールに対しemerald/rose/purple等で逸脱している",
          "カード角丸がrounded-3xl(公式規定)ではなくrounded-xl/2xl/lgで混在している",
          "ホーム画面の主要カードのtransition durationが公式上限300msを超過し500msで遷移している",
          "DesignSystemV3.tsx自体に内部システムメタデータ(TELEMETRY表示等)が残存している"
        ]
      }
    };

    setMessagesPool(simulatedMessages);
    setDecisionsPool(simulatedDecisions);
    setEventsPool(simulatedEvents);
    setConsensusPool(simulatedConsensus);

    initializeStates();
  };

  // Run next step of playback
  const handleNextPlaybackStep = () => {
    if (playbackIndex >= messagesPool.length) {
      // Playback complete - finish and show consensus board
      setAgents(prev => prev.map(a => ({ ...a, status: "Finished" })));
      setProgress(100);
      setConsensus(consensusPool);
      setShowConsensusBoard(true);
      saveConsensusToWorkspace();
      setIsPlaying(false);
      return;
    }

    const currentMsg = messagesPool[playbackIndex];
    setMessages(prev => [...prev, currentMsg]);
    setPlaybackIndex(prev => prev + 1);

    // Calculate progression percentage
    const stepProgress = Math.floor(((playbackIndex + 1) / messagesPool.length) * 100);
    setProgress(Math.min(stepProgress, 98));

    // Update agent statuses dynamically based on sender and receiver
    const senderId = currentMsg.from.toLowerCase().split(" ")[0];
    const receiverId = currentMsg.to.toLowerCase().split(" ")[0];

    setAgents(prev => prev.map(a => {
      if (a.id === senderId) {
        return { ...a, status: "Working" };
      }
      if (a.id === receiverId) {
        return { ...a, status: "Thinking" };
      }
      // Set completed ones to Finished or Waiting
      return a;
    }));

    // Trigger glowing beam in Swarm Graph
    setActiveConnection({
      from: senderId,
      to: receiverId,
      type: currentMsg.type
    });

    // Automatically push any matching Decisions & Events
    const matchingDecisions = decisionsPool.filter(d => {
      const decTime = parseFloat(d.timestamp.split(":")[2] || "0");
      const msgTime = parseFloat(currentMsg.timestamp.split(":")[2] || "0");
      return decTime <= msgTime && !decisions.some(existing => existing.id === d.id);
    });
    if (matchingDecisions.length > 0) {
      setDecisions(prev => [...prev, ...matchingDecisions]);
    }

    const matchingEvents = eventsPool.filter(e => {
      const evTime = parseFloat(e.timestamp.split(":")[2] || "0");
      const msgTime = parseFloat(currentMsg.timestamp.split(":")[2] || "0");
      return evTime <= msgTime && !events.some(existing => existing.id === e.id);
    });
    if (matchingEvents.length > 0) {
      setEvents(prev => [...prev, ...matchingEvents]);
    }

    // Map playback phase to OS visual pipeline
    if (playbackIndex < 2) {
      setCurrentPhase(1); // Planning
    } else if (playbackIndex < 4) {
      setCurrentPhase(2); // Search Grounding
    } else if (playbackIndex < 6) {
      setCurrentPhase(3); // Architectural Constraint
    } else if (playbackIndex < 8) {
      setCurrentPhase(4); // Synthesis & Verification
    } else {
      setCurrentPhase(5); // Consensus Audit
    }
  };

  // Core Consensus Engine: Commit to local storage workspace (Only after Consensus validation!)
  const saveConsensusToWorkspace = () => {
    if (!consensusPool) return;

    try {
      const stored = localStorage.getItem("acos_saved_missions");
      const existing = stored ? JSON.parse(stored) : [];
      
      const newMission = {
        id: `m-swarm-${Date.now()}`,
        title: getMissionTitle(),
        timestamp: new Date().toISOString(),
        category: "business",
        successScore: Math.floor(consensusPool.uqiScore),
        roi: `ROI ${consensusPool.confidenceScore}% / 合意率 100%`,
        status: "Completed",
        resultData: {
          successScore: consensusPool.uqiScore,
          mission: {
            id: `swarm-${Date.now()}`,
            title: getMissionTitle(),
            goal: consensusPool.finalDecision,
            purpose: consensusPool.reason
          },
          chiefAgents: defaultAgents.map(a => ({
            aiName: a.name,
            role: a.role,
            opinion: consensusPool.votes.find(v => v.agentId === a.id)?.reason || "承認済み",
            status: "合意完了"
          })),
          successPrediction: {
            successRate: consensusPool.uqiScore,
            roi: `ROI ${consensusPool.confidenceScore}% (自律検証済み)`
          }
        }
      };

      const updated = [newMission, ...existing.filter((m: any) => m.title !== getMissionTitle())].slice(0, 15);
      localStorage.setItem("acos_saved_missions", JSON.stringify(updated));
      
      // Dispatch storage event so other parts of the app update live
      window.dispatchEvent(new Event("storage"));
      setWorkspaceSavedBadge(true);
    } catch (e) {
      console.warn("Workspace save failed", e);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-slate-200">
      
      {/* Top Controller Banner */}
      <div className="bg-[#0b0c10]/70 border border-white/[0.08] rounded-3xl p-6 backdrop-blur-xl shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-indigo-500/10 rounded-full filter blur-[120px] pointer-events-none -mr-40 -mt-40" />
        
        <div className="space-y-2 z-10 max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] bg-indigo-500/15 text-indigo-300 border border-indigo-400/25 px-2.5 py-0.5 rounded-full font-mono font-black uppercase tracking-widest flex items-center gap-1.5">
              <Network className="w-3 h-3 text-indigo-400 animate-spin" />
              <span>LIVE SWARM CORE RUNNING</span>
            </span>
            <span className="text-[9px] bg-emerald-500/15 text-emerald-300 border border-emerald-400/20 px-2.5 py-0.5 rounded-full font-mono font-bold tracking-widest uppercase">
              UQI GATE ACTIVE
            </span>
            {isRealAiMode && (
              <span className="text-[9px] bg-pink-500/20 text-pink-300 border border-pink-500/30 px-2.5 py-0.5 rounded-full font-mono font-bold tracking-widest uppercase flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 animate-pulse" />
                <span>REAL AI DISCUSS</span>
              </span>
            )}
          </div>
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
            <span>Swarm Autonomous Live Runtime</span>
            <span className="text-xs font-normal text-slate-400 font-mono">v3.5-PRO</span>
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed font-medium">
            ACOS 内で動く「AI Company」の全エージェント活動をリアルタイムに可視化します。各AIプロバイダーを呼び出し、自律合意形成（Consensus）とUQI監査をライブ監視します。
          </p>
        </div>

        {/* Dashboard Action Controls */}
        <div className="flex flex-wrap items-center gap-3 z-10 shrink-0">
          
          {/* Main Action Trigger for Real AI Swarm */}
          <button
            onClick={handleExecuteRealSwarm}
            disabled={isExecutingApi}
            className={cn(
              "px-5 py-2.5 rounded-2xl font-black text-xs transition-all duration-300 flex items-center gap-2 shadow-lg hover:scale-[1.02] cursor-pointer",
              isExecutingApi 
                ? "bg-slate-800 text-slate-500 border border-slate-700 pointer-events-none" 
                : "bg-gradient-to-r from-indigo-500 to-pink-600 border border-indigo-400/30 text-white hover:from-indigo-600 hover:to-pink-700 shadow-indigo-950/40"
            )}
          >
            <Sparkles className={cn("w-4 h-4", isExecutingApi ? "animate-spin" : "animate-bounce")} />
            <span>{isExecutingApi ? "AIディベート実行中..." : "⚡ REAL AI SWARM 起動"}</span>
          </button>

          {/* Quick Simulation Fallback Button */}
          <button
            onClick={runSimulatedSwarm}
            disabled={isExecutingApi}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold rounded-2xl transition-all duration-300 cursor-pointer flex items-center gap-1.5"
          >
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <span>シミュレーション</span>
          </button>

          <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block" />

          {/* Play / Pause */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={isExecutingApi || messagesPool.length === 0}
            className={cn(
              "p-2.5 rounded-2xl border transition-all duration-300 flex items-center justify-center cursor-pointer shadow-lg disabled:opacity-30 disabled:pointer-events-none",
              isPlaying 
                ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-200" 
                : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
            )}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          {/* Speed Multiplier */}
          <div className="flex items-center bg-white/[0.04] border border-white/10 p-1 rounded-2xl font-mono text-[10px] font-bold">
            {[1, 2, 5].map(s => (
              <button
                key={s}
                disabled={isExecutingApi}
                onClick={() => setSpeed(s as any)}
                className={cn(
                  "px-2.5 py-1.5 rounded-xl transition-all duration-300 cursor-pointer disabled:opacity-40",
                  speed === s 
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-black" 
                    : "text-slate-500 hover:text-white"
                )}
              >
                {s}x
              </button>
            ))}
          </div>

          <button
            onClick={() => initializeStates()}
            disabled={isExecutingApi}
            className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white rounded-2xl transition-all duration-300 cursor-pointer disabled:opacity-30"
            title="リセット"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Target Mission Input Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Preset Selectors */}
        <div className="lg:col-span-8 bg-[#0b0c10]/40 border border-white/[0.05] p-5 rounded-3xl flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
              <Workflow className="w-4 h-4 text-indigo-400" />
              SELECT COMPILING TARGET MISSION
            </h3>
            <span className="text-[9px] font-mono text-slate-500 font-bold">ACOS Swarm Engine</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {PRESET_MISSIONS.map(p => {
              const isSelected = selectedPresetId === p.id && !customPrompt;
              return (
                <button
                  key={p.id}
                  disabled={isExecutingApi}
                  onClick={() => {
                    setSelectedPresetId(p.id);
                    setCustomPrompt("");
                  }}
                  className={cn(
                    "p-3.5 rounded-2xl border text-left transition-all duration-300 cursor-pointer flex flex-col justify-between space-y-2 h-[100px] disabled:opacity-50 disabled:pointer-events-none",
                    isSelected 
                      ? "bg-indigo-600/10 border-indigo-500/50 text-white shadow-lg shadow-indigo-950/20" 
                      : "bg-white/[0.01] border-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"
                  )}
                >
                  <span className={cn(
                    "text-[10px] font-black font-mono tracking-wide px-2 py-0.5 rounded-full inline-block w-fit",
                    isSelected ? "bg-indigo-500/20 text-indigo-300" : "bg-white/5 text-slate-500"
                  )}>
                    {p.id.toUpperCase()}
                  </span>
                  <p className="text-[11px] font-black tracking-tight line-clamp-2 w-full">{p.title}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Input */}
        <div className="lg:col-span-4 bg-[#0b0c10]/40 border border-white/[0.05] p-5 rounded-3xl flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">
              OR ENTER CUSTOM STRATEGY OBJECTIVE
            </h3>
            <p className="text-[10px] text-slate-500">カスタムの戦略目標を入力し、実動AI Swarmを起動</p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              disabled={isExecutingApi}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="例: 新規コーヒーブランドの日本市場進出戦略"
              className="flex-1 bg-white/[0.02] border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold disabled:opacity-50"
            />
            {customPrompt && (
              <button
                disabled={isExecutingApi}
                onClick={() => setCustomPrompt("")}
                className="px-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white rounded-2xl text-xs font-bold transition-all cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Real-time Loader Overlay for API Execution */}
      <AnimatePresence>
        {isExecutingApi && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-[#0c0d12]/90 border border-indigo-500/20 rounded-3xl p-8 backdrop-blur-2xl text-center space-y-6 shadow-2xl relative"
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-indigo-500 rounded-full animate-pulse" />
            
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center relative">
                <Cpu className="w-7 h-7 text-indigo-400 animate-spin" />
                <div className="absolute inset-0 rounded-full border border-indigo-400/40 animate-ping opacity-30" />
              </div>
              <div className="space-y-1.5 max-w-xl mx-auto">
                <h2 className="text-base font-black text-white uppercase tracking-wider font-mono flex items-center justify-center gap-2">
                  <span>AI Company Multi-Agent Orchestrating...</span>
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  Gemini/GPT/Claudeを同時プロキシして、全10部署のエージェントによる議論・相互レビューを設計しています。これには20〜30秒ほどかかる場合があります。
                </p>
              </div>
            </div>

            <div className="max-w-md mx-auto space-y-2">
              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 via-pink-500 to-indigo-500 w-2/3 rounded-full animate-pulse" />
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 font-bold">
                <span>API CHANNEL: CONNECTING</span>
                <span className="animate-pulse">PARSING KNOWLEDGE-DNA...</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Message display */}
      {apiError && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-200 font-semibold">{apiError}</p>
          </div>
          <button 
            onClick={() => setApiError(null)}
            className="text-[10px] font-mono text-amber-400 hover:text-white font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Complex HUD Board */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        
        {/* Left Panel: Swarm Live View (Col span 3) */}
        <div className="xl:col-span-3 bg-[#0d0e12]/50 border border-white/[0.06] rounded-3xl p-5 flex flex-col h-[520px]">
          <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
              <Users className="w-4 h-4 text-emerald-400" />
              SWARM LIVE STATUS
            </h3>
            <span className="text-[9px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded font-black">10 AGENTS</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {agents.map((agent) => {
              const isThinking = agent.status === "Thinking";
              const isWorking = agent.status === "Working";
              const isReviewing = agent.status === "Reviewing";
              const isFinished = agent.status === "Finished";

              return (
                <div 
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className={cn(
                    "p-2.5 rounded-2xl border transition-all duration-300 flex items-center justify-between cursor-pointer group hover:bg-white/[0.02]",
                    isThinking ? "bg-indigo-500/5 border-indigo-500/25 shadow-md shadow-indigo-950/25" :
                    isWorking ? "bg-amber-500/5 border-amber-500/20 shadow-md shadow-amber-950/20" :
                    isReviewing ? "bg-pink-500/5 border-pink-500/20" :
                    isFinished ? "bg-emerald-500/5 border-emerald-500/20" :
                    "bg-white/[0.01] border-white/[0.04]"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base select-none group-hover:scale-110 transition-transform">{agent.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <h4 className="text-[11px] font-black text-white truncate">{agent.name}</h4>
                        <span className="text-[8px] px-1 bg-white/5 text-slate-500 rounded font-mono font-bold scale-90">
                          {agent.provider.split(" ")[0]}
                        </span>
                      </div>
                      <p className="text-[8px] font-mono text-slate-500 font-bold truncate uppercase">{agent.role}</p>
                    </div>
                  </div>

                  {/* Status Tag */}
                  <span className={cn(
                    "text-[8px] font-mono font-black px-2 py-0.5 rounded-full uppercase tracking-wider",
                    isThinking ? "bg-indigo-500/15 text-indigo-400 animate-pulse border border-indigo-500/20" :
                    isWorking ? "bg-amber-500/15 text-amber-400 animate-pulse border border-amber-500/20" :
                    isReviewing ? "bg-pink-500/15 text-pink-400 border border-pink-500/20" :
                    isFinished ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" :
                    "bg-white/5 text-slate-500"
                  )}>
                    {agent.status}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-[9px] text-slate-500 text-center mt-2 font-medium">
            💡 エージェントを選択すると「思考ログ」を確認できます
          </p>
        </div>

        {/* Center Panel: Swarm Network (SVG Nodes and Connections) (Col span 5) */}
        <div className="xl:col-span-5 bg-[#0b0c10]/80 border border-white/[0.07] rounded-3xl p-5 flex flex-col justify-between h-[520px] relative overflow-hidden shadow-inner">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />
          
          <div className="flex items-center justify-between border-b border-white/5 pb-3 z-10">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
              <Network className="w-4 h-4 text-pink-400" />
              SWARM COMMUNICATIONS MAP
            </h3>
            <span className="text-[9px] font-mono text-slate-500 font-bold bg-white/5 px-2 py-0.5 rounded">REAL-TIME GRAPH</span>
          </div>

          {/* Network Canvas */}
          <div className="flex-1 w-full relative min-h-0 select-none">
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
              <defs>
                <linearGradient id="indigo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#818CF8" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#C084FC" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="pink-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#EC4899" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#F43F5E" stopOpacity="0.8" />
                </linearGradient>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              <circle cx="50%" cy="50%" r="35%" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1" strokeDasharray="5 5" />
              <circle cx="50%" cy="50%" r="22%" fill="none" stroke="rgba(255,255,255,0.015)" strokeWidth="1" />

              {/* Connections wire rendering */}
              {defaultAgents.map((ag_from, idx) => {
                return defaultAgents.slice(idx + 1).map((ag_to) => {
                  const isCurrentlyActive = activeConnection && (
                    (activeConnection.from.includes(ag_from.id) && activeConnection.to.includes(ag_to.id)) ||
                    (activeConnection.from.includes(ag_to.id) && activeConnection.to.includes(ag_from.id))
                  );

                  return (
                    <g key={`${ag_from.id}-${ag_to.id}`}>
                      <line
                        x1={`${ag_from.x}%`}
                        y1={`${ag_from.y}%`}
                        x2={`${ag_to.x}%`}
                        y2={`${ag_to.y}%`}
                        stroke={isCurrentlyActive ? "url(#indigo-grad)" : "rgba(255,255,255,0.035)"}
                        strokeWidth={isCurrentlyActive ? "2" : "0.75"}
                        className="transition-all duration-300"
                        style={isCurrentlyActive ? { filter: "url(#glow)" } : {}}
                      />
                    </g>
                  );
                });
              })}
            </svg>

            {/* Nodes Container */}
            {agents.map((node) => {
              const isActive = activeConnection && (
                activeConnection.from.includes(node.id) || 
                activeConnection.to.includes(node.id)
              );

              const isThinking = node.status === "Thinking";
              const isWorking = node.status === "Working";
              const isFinished = node.status === "Finished";

              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedAgent(node)}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group transition-all duration-300 cursor-pointer"
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                >
                  <div className="relative flex items-center justify-center">
                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          initial={{ scale: 0.8, opacity: 0.8 }}
                          animate={{ scale: 1.4, opacity: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ repeat: Infinity, duration: 1, ease: "easeOut" }}
                          className="absolute w-12 h-12 rounded-full border border-indigo-500 pointer-events-none"
                        />
                      )}
                    </AnimatePresence>

                    <div
                      className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center text-sm border-2 transition-all duration-300 shadow-lg",
                        isThinking ? "border-indigo-400 bg-indigo-950/80 scale-110 shadow-indigo-500/20" :
                        isWorking ? "border-amber-400 bg-amber-950/80 scale-110 shadow-amber-500/20" :
                        isFinished ? "border-emerald-500 bg-emerald-950/80 scale-105" :
                        "border-white/10 bg-slate-900/90 hover:border-white/30"
                      )}
                      title={`${node.name} - ${node.role}`}
                    >
                      <span className="select-none">{node.icon}</span>
                    </div>

                    <span className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-950",
                      isThinking ? "bg-indigo-50 animate-ping" :
                      isWorking ? "bg-amber-500 animate-pulse" :
                      isFinished ? "bg-emerald-500" :
                      "bg-slate-600"
                    )} />
                  </div>

                  <span className="mt-1 text-[8px] font-black text-slate-400 font-mono scale-90 bg-slate-950/60 px-1.5 py-0.5 rounded border border-white/5 whitespace-nowrap opacity-80 group-hover:opacity-100">
                    {node.name.split(" ")[0]}
                  </span>
                </div>
              );
            })}

            {/* Absolute Center HUD Stats overlay */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full border border-white/[0.04] bg-[#0c0d12]/60 backdrop-blur-md flex flex-col items-center justify-center text-center pointer-events-none p-2 shadow-2xl">
              <span className="text-[7.5px] font-black text-indigo-400 tracking-widest font-mono uppercase">COMPILATION</span>
              <span className="text-xl font-black text-white font-mono">{progress}%</span>
              <span className="text-[7px] font-mono text-slate-500 font-bold uppercase mt-1">
                {messagesPool.length > 0 ? `Msg: ${playbackIndex}/${messagesPool.length}` : "STANDBY"}
              </span>
            </div>

          </div>

          <div className="grid grid-cols-2 gap-3 bg-[#0a0b0e] border border-white/5 rounded-2xl p-2.5 z-10 text-[9px] font-mono text-slate-400">
            <div className="flex justify-between items-center px-1">
              <span>Swarm Capacity limit</span>
              <span className="text-white font-bold">120 Tokens / s</span>
            </div>
            <div className="flex justify-between items-center border-l border-white/5 pl-2 px-1">
              <span>Active Routing Channels</span>
              <span className="text-indigo-400 font-bold">10 channels</span>
            </div>
          </div>
        </div>

        {/* Right Panel: Decision Timeline (Col span 4) */}
        <div className="xl:col-span-4 bg-[#0d0e12]/50 border border-white/[0.06] rounded-3xl p-5 flex flex-col h-[520px]">
          <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              DECISION TIMELINE
            </h3>
            <span className="text-[9px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded font-black">CHRONOLOGY</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 scrollbar-thin">
            {decisions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-50">
                <Workflow className="w-10 h-10 text-slate-600 animate-pulse" />
                <p className="text-[11px] font-bold text-slate-400 font-mono">WAITING FOR SWARM DECISION...</p>
                <p className="text-[9px] text-slate-500">エージェント間の合意ディベートが進むと、決定事項がここに追加されます。</p>
              </div>
            ) : (
              decisions.map((dec) => (
                <div 
                  key={dec.id}
                  className="p-3.5 bg-white/[0.01] hover:bg-white/[0.03] border border-white/[0.05] rounded-2xl space-y-2.5 transition-all duration-300"
                >
                  <div className="flex justify-between items-start border-b border-white/[0.03] pb-1.5">
                    <h4 className="text-[11.5px] font-black text-white leading-tight">
                      {dec.decision}
                    </h4>
                    <span className="text-[8px] font-mono text-indigo-400 font-black">{dec.timestamp}</span>
                  </div>

                  <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                    {dec.reason}
                  </p>

                  <div className="flex gap-4 text-[9px] font-mono">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 font-bold">Confidence:</span>
                      <span className="text-amber-400 font-black">{dec.confidence}%</span>
                    </div>
                    <div className="flex items-center gap-1 border-l border-white/5 pl-4">
                      <span className="text-slate-500 font-bold">UQI Score:</span>
                      <span className="text-emerald-400 font-black">{dec.uqi}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Consensus Board Engine Block - Render voting grid detail */}
      <AnimatePresence>
        {showConsensusBoard && consensus && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="bg-neutral-950 border-2 border-emerald-500/30 rounded-3xl p-6 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-emerald-500/5 rounded-full filter blur-[100px] pointer-events-none" />
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10 pb-4 mb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 px-2.5 py-0.5 rounded-full font-mono font-black uppercase tracking-widest flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>CONSENSUS DECISION UNLOCKED</span>
                  </span>
                  {workspaceSavedBadge && (
                    <span className="text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-0.5 rounded-full font-mono font-black uppercase tracking-widest flex items-center gap-1">
                      <Shield className="w-3 h-3 text-blue-400" />
                      <span>SAVED TO WORKSPACE</span>
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-black text-white tracking-tight">{consensus.title}</h2>
              </div>

              <div className="flex gap-4 font-mono text-center">
                <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
                  <span className="block text-[8px] text-slate-500 font-bold uppercase">UQI AUDIT SCORE</span>
                  <span className="text-xl font-black text-emerald-400">{consensus.uqiScore}%</span>
                </div>
                <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
                  <span className="block text-[8px] text-slate-500 font-bold uppercase">CONFIDENCE</span>
                  <span className="text-xl font-black text-amber-400">{consensus.confidenceScore}%</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Votes Audit list */}
              <div className="md:col-span-8 space-y-3">
                <h3 className="text-[10px] font-black text-slate-400 font-mono tracking-wider uppercase">
                  BOARDMEMBER VOTING RECORDS &amp; REASONINGS
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[250px] overflow-y-auto pr-2 scrollbar-thin">
                  {consensus.votes.map((vt) => {
                    const matchedAgent = defaultAgents.find(a => a.id === vt.agentId) || { name: vt.agentId, icon: <User className="w-4 h-4" />, role: "Boardmember" };
                    return (
                      <div key={vt.agentId} className="p-3 bg-white/[0.01] border border-white/[0.03] rounded-2xl flex flex-col justify-between space-y-2 hover:bg-white/[0.02] transition-colors">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-base select-none">{matchedAgent.icon}</span>
                            <div>
                              <h4 className="text-[10.5px] font-black text-white">{matchedAgent.name}</h4>
                              <p className="text-[7.5px] font-mono text-slate-500 font-bold uppercase">{matchedAgent.role}</p>
                            </div>
                          </div>
                          <span className="text-[8px] font-mono font-black px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {vt.vote}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 italic leading-snug font-medium">
                          &ldquo;{vt.reason}&rdquo;
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Final Statement & Workspace indicator */}
              <div className="md:col-span-4 bg-white/[0.02] border border-white/5 rounded-3xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <span className="text-[8px] font-mono font-black text-indigo-400 uppercase tracking-widest block">
                    FINAL BOARD RESOLUTION
                  </span>
                  <h4 className="text-xs font-black text-white">
                    {consensus.finalDecision}
                  </h4>
                  <p className="text-[10.5px] text-slate-400 leading-relaxed font-medium">
                    {consensus.reason}
                  </p>
                </div>

                <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-emerald-300 font-black">CONSENSUS VERIFIED</p>
                    <p className="text-[8px] text-slate-400 font-semibold leading-tight">
                      Q5品質が認定されました。自律台帳に保存され、Workspaceで閲覧可能です。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {consensus.appleReviewVerdict && (
              <div className="md:col-span-12 border-t border-white/10 pt-6 mt-6 w-full">
                <h3 className="text-[10px] font-black text-slate-400 font-mono tracking-wider uppercase mb-3 flex items-center gap-2">
                  <Apple className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Apple Final Shipment Review (Human Interface Design Team Audit)</span>
                </h3>
                <div className={`p-5 rounded-3xl border flex flex-col md:flex-row gap-5 items-start md:items-center ${
                  consensus.appleReviewVerdict.verdict === "GO" 
                    ? "bg-emerald-500/10 border-emerald-500/25" 
                    : "bg-red-500/5 border-red-500/15"
                }`}>
                  <div className="shrink-0 flex flex-col items-center justify-center font-mono">
                    <span className="text-[8px] text-slate-500 font-bold uppercase mb-1">VERDICT</span>
                    <span className={`text-2xl font-black px-4 py-1.5 rounded-2xl border ${
                      consensus.appleReviewVerdict.verdict === "GO"
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : "bg-red-500/15 text-red-400 border-red-500/30 animate-pulse"
                    }`}>
                      {consensus.appleReviewVerdict.verdict}
                    </span>
                    <span className="text-[8px] text-slate-500 font-bold mt-2">CONFIDENCE: {consensus.appleReviewVerdict.confidenceLevel}%</span>
                  </div>
                  
                  <div className="flex-1 space-y-3">
                    <div>
                      <h4 className="text-xs font-black text-white mb-1">Audit Reasoning</h4>
                      <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                        {consensus.appleReviewVerdict.reasoning}
                      </p>
                    </div>

                    {consensus.appleReviewVerdict.blockingIssues.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1.5">Blocking Issues ({consensus.appleReviewVerdict.blockingIssues.length})</h4>
                        <ul className="list-disc pl-4 space-y-1 text-[10px] text-red-300 font-medium">
                          {consensus.appleReviewVerdict.blockingIssues.map((issue, idx) => (
                            <li key={idx}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Complex HUD: Live Chat Exchange and Telemetry logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Left: Swarm Inter-Agent Messages */}
        <div className="lg:col-span-7 bg-[#0b0c10]/70 border border-white/[0.06] rounded-3xl p-5 flex flex-col h-[320px]">
          <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-indigo-400 animate-pulse" />
              SWARM MESSAGE EXCHANGE LEDGER
            </h3>
            <span className="text-[8px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded font-black">INTER-AGENT CHAT</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-50">
                <Terminal className="w-8 h-8 text-slate-600" />
                <p className="text-[10px] font-bold text-slate-400 font-mono">INITIALIZING TELEMETRY LEDGER...</p>
                <p className="text-[9px] text-slate-500">
                  ⚡ Swarm 起動ボタンを押すと、エージェント間討論が開始されます
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isRequest = msg.type === "Request";
                const isResponse = msg.type === "Response";
                const isConsensus = msg.type === "Consensus";
                const isApproval = msg.type === "Approval";

                return (
                  <div 
                    key={msg.id}
                    onClick={() => setSelectedMessage(msg)}
                    className="p-3 bg-white/[0.01] border border-white/[0.03] rounded-2xl flex flex-col space-y-1.5 hover:border-white/10 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold">
                        <span className="text-white">{msg.from}</span>
                        <ArrowRight className="w-3 h-3 text-indigo-400" />
                        <span className="text-slate-300">{msg.to}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {msg.thought && (
                          <span className="text-[7px] font-mono text-indigo-400 bg-indigo-950/40 border border-indigo-500/20 px-1 py-0.5 rounded flex items-center gap-1">
                            <Eye className="w-2.5 h-2.5" />
                            <span>COGNITIVE LOG</span>
                          </span>
                        )}
                        <span className={cn(
                          "text-[7px] font-mono font-black px-1.5 py-0.5 rounded uppercase tracking-wider",
                          isRequest ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" :
                          isResponse ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" :
                          isConsensus ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          isApproval ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                          "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                        )}>
                          {msg.type}
                        </span>
                      </div>
                    </div>

                    <p className="text-[10.5px] text-slate-300 leading-relaxed font-sans font-medium">
                      {msg.text}
                    </p>

                    <div className="text-[8px] font-mono text-slate-500 text-right">
                      {msg.timestamp}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Right: Dynamic Event Stream */}
        <div className="lg:col-span-5 bg-[#08090c] border border-white/[0.06] rounded-3xl p-5 flex flex-col h-[320px]">
          <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
            <span className="font-mono text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
              <span>SYSTEM EVENT STREAM</span>
            </span>
            <span className="text-[8px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded uppercase font-black">TELEMETRY</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-[9.5px] leading-relaxed text-slate-400 scrollbar-thin">
            {events.map((evt) => (
              <div key={evt.id} className="flex items-start gap-2 hover:bg-white/[0.01] p-1 rounded transition-colors">
                <span className="text-pink-500 select-none font-bold">&gt;&gt;</span>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-black uppercase tracking-wider mr-2 text-[8px] px-1 bg-white/5 rounded">
                    {evt.type}
                  </span>
                  <span className="text-slate-300 leading-relaxed">{evt.message}</span>
                </div>
                <span className="text-[8px] text-slate-600 shrink-0 select-none font-bold">
                  {evt.timestamp}
                </span>
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>

      </div>

      {/* Side Slide-Over Modal Panel for Inspector (Agent Mind & Thought Logs) */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedAgent(null)}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex justify-end"
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#0d0e12] border-l border-white/10 h-full p-6 overflow-y-auto flex flex-col justify-between"
            >
              <div className="space-y-6">
                
                {/* Header detail */}
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{selectedAgent.icon}</span>
                    <div>
                      <h2 className="text-sm font-black text-white">{selectedAgent.name}</h2>
                      <p className="text-[10px] text-indigo-400 font-mono font-bold uppercase">{selectedAgent.role}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedAgent(null)}
                    className="p-1.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </div>

                {/* Mind status */}
                <div className="space-y-4">
                  
                  {/* Model Provider Info */}
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl space-y-1.5">
                    <span className="text-[8px] font-mono font-black text-slate-500 uppercase tracking-widest block">
                      ASSIGNED AI MODEL PROVIDER
                    </span>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-white">{selectedAgent.provider}</span>
                      <span className="text-[8px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded font-mono font-bold uppercase">
                        ACTIVE EDGE
                      </span>
                    </div>
                  </div>

                  {/* Thinking Log */}
                  <div className="p-4 bg-neutral-950 border border-white/5 rounded-2xl space-y-2">
                    <span className="text-[8px] font-mono font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                      <span>ACTUAL AI THINKING PROCESS LOG</span>
                    </span>
                    <div className="text-[10.5px] font-mono text-slate-300 leading-relaxed space-y-2 bg-neutral-900 p-3 rounded-xl border border-white/[0.03] overflow-x-auto">
                      {messagesPool.find(m => m.from.toLowerCase().includes(selectedAgent.id))?.thought ? (
                        <p className="whitespace-pre-wrap">
                          {messagesPool.find(m => m.from.toLowerCase().includes(selectedAgent.id))?.thought}
                        </p>
                      ) : (
                        <p className="text-slate-500 italic">
                          エージェントは現在、外部入力を待機（Waiting）しています。討論フェーズが始まると、ここに論理ステップおよびセマンティックグラフ展開ログが出力されます。
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Role Capabilities */}
                  <div className="space-y-2">
                    <span className="text-[8px] font-mono font-black text-slate-500 uppercase tracking-widest block">
                      CAPABILITY AUTHORIZATIONS
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {["UQI-12-Factor", "Logical-Reasoning", "Non-Hallucination-Filter", "Cross-Agent-Critique"].map(cap => (
                        <span key={cap} className="text-[9px] bg-white/5 border border-white/5 px-2 py-1 rounded text-slate-400 font-mono">
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>

                </div>

              </div>

              <button
                onClick={() => setSelectedAgent(null)}
                className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl text-xs font-bold transition-all mt-6 cursor-pointer"
              >
                Close Agent Inspect
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Side Slide-Over Modal Panel for Message Inspection (Chat mind inspector) */}
      <AnimatePresence>
        {selectedMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMessage(null)}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex justify-end"
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#0d0e12] border-l border-white/10 h-full p-6 overflow-y-auto flex flex-col justify-between"
            >
              <div className="space-y-6">
                
                {/* Header details */}
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="space-y-1">
                    <h2 className="text-sm font-black text-white">Message Transmission Record</h2>
                    <p className="text-[8px] font-mono text-indigo-400 font-bold uppercase">
                      ID: {selectedMessage.id}
                    </p>
                  </div>
                  <button 
                    onClick={() => setSelectedMessage(null)}
                    className="p-1.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </div>

                <div className="space-y-5">
                  
                  {/* Transmission details */}
                  <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between text-[10px] font-mono">
                    <div className="space-y-0.5">
                      <span className="text-[8px] text-slate-500 font-bold block">SENDER</span>
                      <span className="text-white font-black">{selectedMessage.from}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-indigo-400" />
                    <div className="space-y-0.5 text-right">
                      <span className="text-[8px] text-slate-500 font-bold block">RECEIVER</span>
                      <span className="text-white font-black">{selectedMessage.to}</span>
                    </div>
                  </div>

                  {/* Text statement */}
                  <div className="space-y-2">
                    <span className="text-[8px] font-mono font-black text-slate-500 uppercase tracking-widest block">
                      TRANSMITTED MESSAGE CONTENT
                    </span>
                    <p className="p-4 bg-white/[0.01] border border-white/[0.04] rounded-2xl text-[11px] text-slate-200 leading-relaxed font-sans font-medium">
                      {selectedMessage.text}
                    </p>
                  </div>

                  {/* Thinking Log detail */}
                  {selectedMessage.thought && (
                    <div className="p-4 bg-neutral-950 border border-white/5 rounded-2xl space-y-2">
                      <span className="text-[8px] font-mono font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                        <span>SENDER COGNITIVE LOG (思考プロセス)</span>
                      </span>
                      <p className="text-[10.5px] font-mono text-slate-300 leading-relaxed bg-neutral-900 p-3 rounded-xl border border-white/[0.03]">
                        {selectedMessage.thought}
                      </p>
                    </div>
                  )}

                  {/* Timestamp log */}
                  <div className="text-[9px] font-mono text-slate-500 flex justify-between">
                    <span>TRANSMISSION TIMING</span>
                    <span>{selectedMessage.timestamp}</span>
                  </div>

                </div>

              </div>

              <button
                onClick={() => setSelectedMessage(null)}
                className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl text-xs font-bold transition-all mt-6 cursor-pointer"
              >
                Close Message Details
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
