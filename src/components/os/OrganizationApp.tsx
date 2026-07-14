import  { useState } from "react";
import { motion } from "motion/react";
import { 
  Shield, 
   
  Cpu, 
  Check, 
  AlertTriangle, 
   
   
  Key, 
   
   
   
  
  Server,
  Globe,
  Github,
  LogOut,
  RefreshCw,
  Lock,
  BookOpen
} from "lucide-react";
import { cn } from "../../utils";
import { Settings as AppSettings, AIAgentConfig } from "../../types";

interface OrganizationAppProps {
  settings: AppSettings;
  updateSettings: (s: AppSettings) => void;
}

const AGENTS_LIST: AIAgentConfig[] = [
  { id: "gemini", name: "Google Gemini 3.5 Flash", description: "Googleの高精度・高速推論モデル（デフォルト有効・高速並列）", icon: "♊", status: "active", provider: "Google" },
  { id: "openai", name: "OpenAI GPT-4o / Router", description: "GPT-4oおよびOpenRouter各種モデル。コンテキスト拡張に対応", icon: "🟢", status: "active", provider: "OpenAI" },
  { id: "claude", name: "Claude 3.5 Sonnet (Anthropic)", description: "極めて高精度な日本語・構造コード生成。将来対応予定", icon: "🍁", status: "planned", provider: "Anthropic" },
  { id: "perplexity", name: "Perplexity AI Spec", description: "リアルタイムWeb検索と連動した最新情報の収集。将来対応予定", icon: "🔍", status: "planned", provider: "Perplexity" },
  { id: "deepseek", name: "DeepSeek-V3 / R1", description: "推論と構造化、数学的評価に特化した最新モデル。将来対応予定", icon: "🐳", status: "planned", provider: "DeepSeek" },
];

export default function OrganizationApp({ settings, updateSettings }: OrganizationAppProps) {
  const [activeTab, setActiveTab] = useState<"agents" | "compliance" | "keys" | "language">("agents");
  const [successMsg, setSuccessMsg] = useState("");

  // GitHub integration states
  const [githubToken, setGithubToken] = useState<string>(() => localStorage.getItem("acos_github_token") || "");
  const [githubUser, setGithubUser] = useState<any>(() => {
    try {
      const u = localStorage.getItem("acos_github_user");
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });
  const [githubConnectMethod, setGithubConnectMethod] = useState<"pat" | "oauth">("pat");
  const [patInput, setPatInput] = useState("");
  const [customClientId, setCustomClientId] = useState(() => localStorage.getItem("acos_github_client_id") || "");
  const [customClientSecret, setCustomClientSecret] = useState(() => localStorage.getItem("acos_github_client_secret") || "");
  const [isGitHubConnecting, setIsGitHubConnecting] = useState(false);
  const [githubError, setGithubError] = useState("");

  const isEn = settings.language === "en";

  // Handle Personal Access Token validation
  const handleConnectPAT = async () => {
    if (!patInput.trim()) {
      setGithubError(isEn ? "Please enter your GitHub Personal Access Token." : "GitHub個人アクセストークンを入力してください。");
      return;
    }
    setIsGitHubConnecting(true);
    setGithubError("");

    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${patInput.trim()}`,
          "Accept": "application/vnd.github.v3+json"
        }
      });

      if (!response.ok) {
        throw new Error(isEn ? "Failed to authenticate. Please verify your token." : "認証に失敗しました。トークンを確認してください。");
      }

      const userData = await response.json();
      localStorage.setItem("acos_github_token", patInput.trim());
      localStorage.setItem("acos_github_user", JSON.stringify(userData));
      setGithubToken(patInput.trim());
      setGithubUser(userData);
      setSuccessMsg(isEn ? "GitHub account linked successfully!" : "GitHubアカウントが正常に連携されました！");
      setTimeout(() => setSuccessMsg(""), 3000);
      setPatInput("");
    } catch (err: any) {
      setGithubError(err.message || "Authentication error.");
    } finally {
      setIsGitHubConnecting(false);
    }
  };

  // Handle OAuth Popup flow
  const handleConnectOAuth = async () => {
    setIsGitHubConnecting(true);
    setGithubError("");

    try {
      // Get Auth URL
      const clientIdQuery = customClientId.trim() ? `clientId=${customClientId.trim()}&` : "";
      const redirectUri = `${window.location.origin}/auth/callback`;
      const urlResponse = await fetch(`/api/auth/github/url?${clientIdQuery}redirectUri=${encodeURIComponent(redirectUri)}`);
      if (!urlResponse.ok) {
        const errObj = await urlResponse.json();
        throw new Error(errObj.error || "Failed to generate authorization URL.");
      }

      const { url } = await urlResponse.json();

      // Store custom client credentials in localStorage to survive popup redirects or reuse
      if (customClientId.trim()) {
        localStorage.setItem("acos_github_client_id", customClientId.trim());
      }
      if (customClientSecret.trim()) {
        localStorage.setItem("acos_github_client_secret", customClientSecret.trim());
      }

      // Open Popup
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      const authWindow = window.open(
        url,
        "github_oauth_popup",
        `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes`
      );

      if (!authWindow) {
        throw new Error(isEn ? "Popup blocked. Please allow popups for this site." : "ポップアップがブロックされました。ポップアップを許可してください。");
      }

      // Listen for postMessage from callback popup
      const handleMessageEvent = async (event: MessageEvent) => {
        if (event.data?.type === "GITHUB_AUTH_CODE") {
          const code = event.data.code;
          window.removeEventListener("message", handleMessageEvent);
          
          try {
            // Exchange code
            const exchangeResponse = await fetch("/api/auth/github/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code,
                clientId: customClientId.trim() || undefined,
                clientSecret: customClientSecret.trim() || undefined,
                redirectUri
              })
            });

            if (!exchangeResponse.ok) {
              const errObj = await exchangeResponse.json();
              throw new Error(errObj.error || "Token exchange failed.");
            }

            const tokenData = await exchangeResponse.json();
            const token = tokenData.access_token;

            if (!token) {
              throw new Error("No access token returned from exchange.");
            }

            // Fetch user profile with token
            const profileResponse = await fetch("https://api.github.com/user", {
              headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github.v3+json"
              }
            });

            if (!profileResponse.ok) {
              throw new Error("Failed to retrieve user profile with access token.");
            }

            const userData = await profileResponse.json();
            localStorage.setItem("acos_github_token", token);
            localStorage.setItem("acos_github_user", JSON.stringify(userData));
            setGithubToken(token);
            setGithubUser(userData);
            setSuccessMsg(isEn ? "GitHub account linked successfully via OAuth!" : "OAuth経由でGitHubアカウントが正常に連携されました！");
            setTimeout(() => setSuccessMsg(""), 3000);
          } catch (exchangeErr: any) {
            setGithubError(exchangeErr.message || "Failed during token exchange.");
          } finally {
            setIsGitHubConnecting(false);
          }
        }
      };

      window.addEventListener("message", handleMessageEvent);

    } catch (err: any) {
      setGithubError(err.message || "OAuth connection failed.");
      setIsGitHubConnecting(false);
    }
  };

  // Disconnect GitHub
  const handleDisconnectGitHub = () => {
    localStorage.removeItem("acos_github_token");
    localStorage.removeItem("acos_github_user");
    setGithubToken("");
    setGithubUser(null);
    setSuccessMsg(isEn ? "GitHub disconnected." : "GitHubの連携を解除しました。");
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  const toggleAgent = (agentId: string) => {
    const isSelected = settings.selectedAgents.includes(agentId);
    let updated: string[];
    if (isSelected) {
      if (settings.selectedAgents.length <= 1) return;
      updated = settings.selectedAgents.filter(id => id !== agentId);
    } else {
      updated = [...settings.selectedAgents, agentId];
    }
    updateSettings({
      ...settings,
      selectedAgents: updated
    });
    
    setSuccessMsg(isEn ? "AI agent alignment updated successfully." : "AIエージェントの構成を更新しました。");
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  return (
    <div data-testid="settings-screen" className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/50 dark:border-white/[0.04] pb-5">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 rounded-full text-[10px] text-blue-600 dark:text-blue-300 font-bold font-mono tracking-widest uppercase">
            <Shield className="w-3.5 h-3.5" />
            {isEn ? "ORGANIZATION CONTROL CENTER & SETTINGS" : "組織コントロールセンター ＆ 環境設定"}
          </div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            {isEn ? "Organization Cockpit" : "組織コクピット"}
          </h2>
          <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium">
            {isEn 
              ? "Configure active parallel AI models, set organizational risk postures, and align safety compliance parameters."
              : "並列稼働するアクティブAIエージェント、セキュリティリスク、コンプライアンスパラメータを構成します。"}
          </p>
        </div>
      </div>

      {/* Cockpit Introduction & Quick Guide */}
      <div className="bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/[0.04] p-4 rounded-2xl relative overflow-hidden flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 font-mono">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            {isEn ? "WHAT IS THE COCKPIT?" : "コクピット機能の目的と使い方"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed font-sans">
            {isEn
              ? "The Cockpit serves as the centralized governance framework for your enterprise workspace. It controls parallel agent distribution, UQI security protocols, and secure OAuth connectivity."
              : "組織コクピットは、ワークスペース全体を統制・監査するための「管理・設定司令塔」です。自律並列処理を行うAIメンバーの管理、コンプライアンス（品質保証）、およびGitHub連携をセキュアに構成します。"}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 bg-slate-100 dark:bg-zinc-800/50 px-3 py-2 rounded-xl text-xs text-slate-500 dark:text-neutral-400 self-stretch sm:self-auto justify-center border border-slate-200/50 dark:border-white/5 font-mono">
          <span className="font-bold text-blue-500">💡 {isEn ? "How to use:" : "使い方:"}</span>
          <p className="text-[11px] leading-tight font-sans">
            {isEn 
              ? "Switch tabs to select AI members, set audit limits, or connect Git." 
              : "タブを切り替えて、AI構成の調整、UQI品質限界値、Gitトークン等を設定。"}
          </p>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white/40 dark:bg-neutral-900/20 border border-slate-200/60 dark:border-white/[0.04] p-1.5 rounded-2xl max-w-xl backdrop-blur-md">
        <button
          onClick={() => setActiveTab("agents")}
          className={cn(
            "flex-1 min-w-[90px] py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center",
            activeTab === "agents"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
              : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/20"
          )}
        >
          {isEn ? `AI Agents (${settings.selectedAgents.length})` : `AIメンバー (${settings.selectedAgents.length})`}
        </button>
        <button
          onClick={() => setActiveTab("compliance")}
          className={cn(
            "flex-1 min-w-[90px] py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center",
            activeTab === "compliance"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
              : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/20"
          )}
        >
          {isEn ? "Compliance (UQI)" : "品質監査 (UQI)"}
        </button>
        <button
          onClick={() => setActiveTab("keys")}
          className={cn(
            "flex-1 min-w-[90px] py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center",
            activeTab === "keys"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
              : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/20"
          )}
        >
          {isEn ? "API Integrations" : "外部API接続"}
        </button>
        <button
          onClick={() => setActiveTab("language")}
          className={cn(
            "flex-1 min-w-[90px] py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center flex items-center justify-center gap-1",
            activeTab === "language"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
              : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/20"
          )}
        >
          <Globe className="w-3.5 h-3.5" />
          {isEn ? "Language" : "言語 / Language"}
        </button>
      </div>

      {successMsg && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-bold text-emerald-500 flex items-center gap-2"
        >
          <Check className="w-4 h-4" />
          <span>{successMsg}</span>
        </motion.div>
      )}

      {/* Main Grid content matching active Tab */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Main settings pane */}
        <div className="lg:col-span-2 space-y-6">
          
          {activeTab === "agents" && (
            <div className="space-y-4">
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200 flex items-center gap-2">
                    <Cpu className="w-4.5 h-4.5 text-blue-500" />
                    {isEn ? "AI Company Member Toggles" : "AIメンバー稼働スイッチ"}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    {isEn 
                      ? "Turn specific AI members on or off. Active models will co-deliberate when executing high-value SWOT, Litigation and intelligence missions."
                      : "各AIエージェントの有効/無効を切り替えます。有効なエージェントは高度な戦略分析や調査などのMissionにおいて並列で相互審議を行います。"}
                  </p>
                </div>

                <div className="space-y-3">
                  {AGENTS_LIST.map((agent) => {
                    const isActive = settings.selectedAgents.includes(agent.id);
                    const isPlanned = agent.status === "planned";

                    // Dynamic Description based on Language
                    let desc = agent.description;
                    if (isEn) {
                      if (agent.id === "gemini") desc = "Google's high-precision and ultra-fast reasoning model (Parallel Default Active).";
                      if (agent.id === "openai") desc = "GPT-4o and OpenRouter models. Configured for extensive prompt context support.";
                      if (agent.id === "claude") desc = "Extremely precise Japanese layout and structured code synthesizer. (Planned)";
                      if (agent.id === "perplexity") desc = "Real-time web search and information gathering. (Planned)";
                      if (agent.id === "deepseek") desc = "Specialized in structural thinking, mathematics, and high-depth logic. (Planned)";
                    }

                    return (
                      <div
                        key={agent.id}
                        onClick={() => !isPlanned && toggleAgent(agent.id)}
                        className={cn(
                          "flex items-start justify-between p-4 rounded-2xl border transition-all select-none",
                          isPlanned
                            ? "bg-slate-100/30 dark:bg-neutral-950/20 border-slate-100 dark:border-neutral-900 opacity-60 cursor-not-allowed"
                            : isActive
                              ? "bg-blue-500/[0.02] dark:bg-blue-500/[0.02] border-blue-500/40 cursor-pointer hover:bg-blue-500/[0.04]"
                              : "bg-white dark:bg-neutral-900/10 border-slate-200 dark:border-white/[0.03] cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                        )}
                      >
                        <div className="flex gap-3.5">
                          <span className="text-2xl bg-slate-50 dark:bg-neutral-900 w-11 h-11 rounded-xl flex items-center justify-center border border-slate-100 dark:border-white/[0.04] shrink-0 font-sans">
                            {agent.icon}
                          </span>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-800 dark:text-neutral-200">{agent.name}</span>
                              <span className="text-[9px] px-2 py-0.5 bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-slate-400 rounded-full font-mono font-bold uppercase tracking-wider">
                                {isPlanned ? (isEn ? "Planned" : "予定") : agent.provider}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                              {desc}
                            </p>
                          </div>
                        </div>

                        {!isPlanned && (
                          <div className={cn(
                            "w-5 h-5 rounded-lg flex items-center justify-center border transition-all mt-1 shrink-0",
                            isActive 
                              ? "bg-blue-500 border-blue-500 text-white" 
                              : "border-slate-300 dark:border-white/10"
                          )}>
                            {isActive && <Check className="w-3.5 h-3.5 stroke-[3px]" />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "compliance" && (
            <div className="space-y-4">
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200 flex items-center gap-2">
                    <Shield className="w-4.5 h-4.5 text-emerald-500" />
                    {isEn ? "UQI (Universal Quality Indicators) Compliance" : "UQI (普遍的品質指標) コンプライアンス規格"}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    {isEn 
                      ? "Define strict quality gates and parameters governing how OEvE assembly is performed."
                      : "成果物の組み立てを制御する厳格な品質しきい値とパラメータを定義します。"}
                  </p>
                </div>

                <div className="space-y-3.5 text-xs text-slate-700 dark:text-neutral-300 font-semibold">
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-neutral-900/20 border border-slate-200/50 dark:border-neutral-800 rounded-xl">
                    <div className="space-y-0.5">
                      <p className="text-xs text-slate-800 dark:text-neutral-200">
                        {isEn ? "Enforce Quality Gate Threshold (>95%)" : "品質しきい値制限の強制 (>95%)"}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {isEn ? "Rejects any mission output with high-hallucination indexes." : "ハルシネーション指数が高い不正確な出力を自律的に検出し、再推論を行います。"}
                      </p>
                    </div>
                    <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded font-mono">
                      {isEn ? "ENFORCED" : "適用済み"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-neutral-900/20 border border-slate-200/50 dark:border-neutral-800 rounded-xl">
                    <div className="space-y-0.5">
                      <p className="text-xs text-slate-800 dark:text-neutral-200">
                        {isEn ? "Legal Precedent Compliance Audits" : "判例・コンプライアンス自動監査"}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {isEn ? "Auto-references court proceedings databases for law queries." : "法律に関する問い合わせに対し、関係法令や判例データベースを自動参照します。"}
                      </p>
                    </div>
                    <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded font-mono">
                      {isEn ? "ACTIVE" : "有効"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-neutral-900/20 border border-slate-200/50 dark:border-neutral-800 rounded-xl">
                    <div className="space-y-0.5">
                      <p className="text-xs text-slate-800 dark:text-neutral-200">
                        {isEn ? "Fact-Checking Web Grounding" : "ファクトチェック・ウェブグラウンディング"}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {isEn ? "Aggressively cross-references facts with real-time web search parameters." : "最新情報や特定の事実関係をウェブ検索パラメータと強力に相互参照します。"}
                      </p>
                    </div>
                    <span className="text-[9px] font-bold text-blue-500 bg-blue-500/5 border border-blue-500/10 px-2 py-0.5 rounded font-mono">
                      {isEn ? "GROUNDED" : "検証済み"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "keys" && (
            <div className="space-y-4">
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200 flex items-center gap-2">
                    <Key className="w-4.5 h-4.5 text-amber-500" />
                    {isEn ? "Secure API Credential Alignments" : "セキュアAPI認証情報設定"}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    {isEn ? "Enter third-party keys safely. All credentials are encrypted server-side and never leaked." : "サードパーティ製キーを安全に入力します。すべての認証情報はサーバー側で暗号化され、漏洩することはありません。"}
                  </p>
                </div>

                <div className="space-y-4 text-xs font-semibold">
                  <div className="space-y-1.5">
                    <label className="text-slate-400">{isEn ? "Gemini Secret Key (Implicit)" : "Gemini API キー (暗黙的連携)"}</label>
                    <div className="flex gap-2">
                      <input
                        disabled
                        type="password"
                        value="••••••••••••••••••••••••••••••••"
                        className="flex-1 bg-slate-100 dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3.5 py-2.5 text-slate-500 cursor-not-allowed font-mono"
                      />
                      <span className="text-[10px] text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-3 py-2.5 rounded-xl font-bold flex items-center font-mono">SECURE</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-400">{isEn ? "OpenAI / OpenRouter API Key" : "OpenAI / OpenRouter API キー"}</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="sk-or-••••••••••••••••••••••••••••••••"
                        className="flex-1 bg-slate-50 dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3.5 py-2.5 text-slate-200 placeholder:text-slate-500 font-mono focus:border-indigo-500/50 focus:ring-0 outline-none"
                      />
                      <button 
                        onClick={() => {
                          setSuccessMsg(isEn ? "OpenAI Router key saved securely." : "OpenAI Routerキーを安全に保存しました。");
                          setTimeout(() => setSuccessMsg(""), 3000);
                        }}
                        className="px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                      >
                        {isEn ? "Save" : "保存"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* GitHub Integration Card */}
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-neutral-800 text-white flex items-center justify-center border border-white/10 shadow-sm">
                      <Github className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200">
                        {isEn ? "GitHub Service Integration" : "GitHub サービス連携"}
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                        {isEn ? "Link repository resources, view commit logs, track issues, and sync with AI swarm reasoning." : "リポジトリ資源の参照、コミット履歴、イシュートラッキング、AIナレッジ連携を可能にします。"}
                      </p>
                    </div>
                  </div>
                  {githubUser ? (
                    <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-2.5 py-1 rounded-xl font-mono flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      CONNECTED
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-neutral-800 px-2.5 py-1 rounded-xl font-mono">
                      OFFLINE
                    </span>
                  )}
                </div>

                {githubError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-[11px] font-bold text-rose-500 flex items-center gap-2 font-mono">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{githubError}</span>
                  </div>
                )}

                {!githubUser ? (
                  <div className="space-y-4 pt-2">
                    {/* Segmented connect method picker */}
                    <div className="flex border border-slate-200/60 dark:border-white/[0.04] p-1 rounded-xl bg-slate-50 dark:bg-neutral-950/40">
                      <button
                        onClick={() => setGithubConnectMethod("pat")}
                        className={cn(
                          "flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all cursor-pointer text-center",
                          githubConnectMethod === "pat"
                            ? "bg-white text-slate-900 dark:bg-neutral-800 dark:text-white shadow-xs"
                            : "text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300"
                        )}
                      >
                        Personal Access Token (PAT)
                      </button>
                      <button
                        onClick={() => setGithubConnectMethod("oauth")}
                        className={cn(
                          "flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all cursor-pointer text-center",
                          githubConnectMethod === "oauth"
                            ? "bg-white text-slate-900 dark:bg-neutral-800 dark:text-white shadow-xs"
                            : "text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300"
                        )}
                      >
                        GitHub OAuth Sign-In
                      </button>
                    </div>

                    {githubConnectMethod === "pat" ? (
                      <div className="space-y-2 text-xs font-semibold">
                        <div className="flex items-center justify-between">
                          <label className="text-slate-400">
                            {isEn ? "GitHub Personal Access Token" : "GitHub 個人アクセストークン"}
                          </label>
                          <a 
                            href="https://github.com/settings/tokens/new?scopes=repo,read:user" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] text-indigo-500 hover:underline flex items-center gap-0.5"
                          >
                            <BookOpen className="w-3 h-3" />
                            {isEn ? "Generate Token (Classic)" : "トークン作成ページ"}
                          </a>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={patInput}
                            onChange={(e) => setPatInput(e.target.value)}
                            placeholder="ghp_••••••••••••••••••••••••••••••••"
                            className="flex-1 bg-slate-50 dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3.5 py-2.5 text-slate-800 dark:text-white placeholder:text-slate-500 font-mono focus:border-indigo-500/50 focus:ring-0 outline-none"
                          />
                          <button
                            disabled={isGitHubConnecting}
                            onClick={handleConnectPAT}
                            className="px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                          >
                            {isGitHubConnecting && <RefreshCw className="w-3 h-3 animate-spin" />}
                            <span>{isEn ? "Connect" : "接続する"}</span>
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-neutral-500 leading-normal font-medium mt-2">
                          {isEn 
                            ? "Click the link above to generate a token with 'repo' and 'read:user' scopes. If you are redirected to the GitHub dashboard after logging in, please click the link again. Copy the generated token (ghp_...) and paste it here."
                            : "上の「トークン作成ページ」リンクからトークンを生成し、ここに入力して「接続する」を押してください。※ログイン後にGitHubのトップページ（リポジトリ一覧）に飛ばされた場合は、お手数ですが再度上のリンクをクリックしてください。"}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3.5 text-xs font-semibold">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1 text-[10px] text-amber-500 font-bold uppercase font-mono">
                            <Lock className="w-3.5 h-3.5" />
                            <span>OAuth Client Credentials Config</span>
                          </div>
                          <p className="text-[10px] text-slate-400 leading-normal font-medium mb-2">
                            {isEn 
                              ? "Optional. To use your custom OAuth App, register callback URI as APP_URL/auth/callback and fill below, or leave blank to use global config."
                              : "独自に登録したGitHub OAuthアプリを利用する場合、リダイレクトURIに APP_URL/auth/callback を設定し、以下に入力してください（空欄時は共有環境キーを使用）。"}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-slate-400 text-[10px]">Client ID</label>
                              <input
                                type="text"
                                value={customClientId}
                                onChange={(e) => setCustomClientId(e.target.value)}
                                placeholder="Ov23..."
                                className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3 py-2 text-slate-800 dark:text-white placeholder:text-slate-500 font-mono focus:border-indigo-500/50 focus:ring-0 outline-none"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400 text-[10px]">Client Secret</label>
                              <input
                                type="password"
                                value={customClientSecret}
                                onChange={(e) => setCustomClientSecret(e.target.value)}
                                placeholder="••••••••••••••••••••"
                                className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3 py-2 text-slate-800 dark:text-white placeholder:text-slate-500 font-mono focus:border-indigo-500/50 focus:ring-0 outline-none"
                              />
                            </div>
                          </div>
                        </div>

                        <button
                          disabled={isGitHubConnecting}
                          onClick={handleConnectOAuth}
                          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50"
                        >
                          {isGitHubConnecting ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Github className="w-4 h-4" />
                          )}
                          <span>{isEn ? "Log In via GitHub OAuth Popup" : "GitHub OAuthポップアップでログイン"}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 dark:bg-neutral-950/40 border border-slate-200/50 dark:border-neutral-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <img 
                        src={githubUser.avatar_url} 
                        alt="GitHub Avatar" 
                        className="w-11 h-11 rounded-full border border-slate-200/50 dark:border-neutral-700 shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-slate-800 dark:text-neutral-200">{githubUser.name || githubUser.login}</span>
                          <span className="text-[10px] font-mono text-indigo-500">@{githubUser.login}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium font-mono">
                          {isEn ? "Repos: " : "リポジトリ数: "}{githubUser.public_repos} • {isEn ? "Followers: " : "フォロワー: "}{githubUser.followers}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleDisconnectGitHub}
                      className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 border border-rose-500/20 active:scale-95"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{isEn ? "Disconnect" : "連携解除"}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "language" && (
            <div className="space-y-4">
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200 flex items-center gap-2">
                    <Globe className="w-4.5 h-4.5 text-indigo-500" />
                    {isEn ? "Language Configuration / 言語設定" : "言語設定 / Language Configuration"}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    {isEn 
                      ? "Select your preferred interface language. Interface terminology and system descriptions will adapt automatically."
                      : "システム全体の表示言語を設定します。インターフェースの各種用語やシステムの説明文が自動的に切り替わります。"}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div
                    onClick={() => {
                      updateSettings({ ...settings, language: "ja" });
                      setSuccessMsg("表示言語を日本語に切り替えました。");
                      setTimeout(() => setSuccessMsg(""), 3000);
                    }}
                    className={cn(
                      "p-4 rounded-2xl border transition-all cursor-pointer select-none relative overflow-hidden",
                      settings.language === "ja"
                        ? "bg-indigo-500/[0.02] dark:bg-indigo-500/[0.02] border-indigo-500/40 shadow-sm"
                        : "bg-white dark:bg-neutral-900/10 border-slate-200 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🇯🇵</span>
                        <span className="text-xs font-black text-slate-800 dark:text-neutral-200">日本語 (Japanese)</span>
                      </div>
                      {settings.language === "ja" && (
                        <span className="w-2 h-2 rounded-full bg-indigo-500" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 font-medium leading-relaxed">
                      システム全体で日本語表示を基本に設定します。(デフォルト)
                    </p>
                  </div>

                  <div
                    onClick={() => {
                      updateSettings({ ...settings, language: "en" });
                      setSuccessMsg("Interface language switched to English.");
                      setTimeout(() => setSuccessMsg(""), 3000);
                    }}
                    className={cn(
                      "p-4 rounded-2xl border transition-all cursor-pointer select-none relative overflow-hidden",
                      settings.language === "en"
                        ? "bg-indigo-500/[0.02] dark:bg-indigo-500/[0.02] border-indigo-500/40 shadow-sm"
                        : "bg-white dark:bg-neutral-900/10 border-slate-200 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🇺🇸</span>
                        <span className="text-xs font-black text-slate-800 dark:text-neutral-200">English (English)</span>
                      </div>
                      {settings.language === "en" && (
                        <span className="w-2 h-2 rounded-full bg-indigo-500" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 font-medium leading-relaxed">
                      Switch the user interface and analytics terms to English.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Right 1 Col: Compliance diagnostics */}
        <div className="space-y-6">
          
          <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4 shadow-xs">
            <h4 className="text-xs font-black text-slate-800 dark:text-neutral-300 uppercase tracking-widest font-mono">
              {isEn ? "Diagnostic Core Status" : "システム監査ステータス"}
            </h4>
            <div className="space-y-3.5 text-xs">
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">{isEn ? "Risk Posture Rating" : "セキュリティ評価基準"}</span>
                <span className="font-mono text-emerald-500 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {isEn ? "AAA PERFECT" : "AAA 完全適合"}
                </span>
              </div>
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">{isEn ? "Active Model Parallelism" : "アクティブモデル並列数"}</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">{isEn ? "Dual-Model Active" : "デュアルモデルアクティブ"}</span>
              </div>
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">{isEn ? "OEvE Memory Cache size" : "OEvEメモリキャッシュ数"}</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">{isEn ? "2,410 synapses" : "2,410 シナプス"}</span>
              </div>
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">{isEn ? "UQI Quality Assurance Code" : "UQI品質保証コード"}</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">ACOS-SIL-V2</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#09090D] via-[#121216] to-[#0E0E12] text-white border border-white/[0.05] p-5 rounded-2xl space-y-3.5">
            <div className="flex items-center gap-2 text-[10px] text-pink-400 font-mono tracking-widest uppercase">
              <Server className="w-3.5 h-3.5" />
              <span>{isEn ? "Security Audit Trail" : "セキュリティ監査証跡"}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-normal font-semibold">
              {isEn 
                ? "All transactions, prompt compilations, and strategic analysis results undergo standard industry audits before being safely saved to local workspaces."
                : "すべてのトランザクション、プロンプトのコンパイル、および戦略分析結果は、ローカルワークスペースに安全に保存される前に、業界標準のセキュリティ監査を受けます。"}
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
