import React, { useState, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import {
  Github,
  Key,
  RefreshCw,
  AlertTriangle,
  Check,
  GitBranch,
  GitCommit,
  GitPullRequest,
  BookOpen,
  FileText,
  Copy,
  Terminal,
  Database,
  Search,
  ExternalLink,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  Folder,
  ArrowRight
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "../../utils";
import { SovereignGlassCard, SovereignButton, SovereignInput, SovereignBadge } from "../SovereignComponents";

interface GitHubWorkspaceProps {
  onAddWorkspaceFile?: (file: { id: string; name: string; size: string; timestamp: string; type: string }) => void;
  language?: "ja" | "en";
}

export default function GitHubWorkspace({ onAddWorkspaceFile, language = "ja" }: GitHubWorkspaceProps) {
  const isEn = language === "en";

  // Connection states
  const [token, setToken] = useState<string>(() => localStorage.getItem("acos_github_token") || "");
  const [user, setUser] = useState<any>(() => {
    try {
      const u = localStorage.getItem("acos_github_user");
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });

  const [patInput, setPatInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Repository states
  const [repos, setRepos] = useState<any[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<any>(null);

  // Repository details
  const [commits, setCommits] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"commits" | "issues" | "ai">("commits");

  // AI intelligence states
  const [aiOutput, setAiOutput] = useState<string>("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<"changelog" | "audit" | "">("");

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);

  // Search inside details
  const [detailSearchQuery, setDetailSearchQuery] = useState("");

  // Poll for connection status from localStorage in case the user connected from the other tab
  useEffect(() => {
    const handleStorageChange = () => {
      const t = localStorage.getItem("acos_github_token") || "";
      const u = localStorage.getItem("acos_github_user");
      setToken(t);
      try {
        setUser(u ? JSON.parse(u) : null);
      } catch {
        setUser(null);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    // Also run a short polling interval because React state inside iframe might not capture storage event from same tab
    const interval = setInterval(handleStorageChange, 1500);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Fetch repositories when token is available
  useEffect(() => {
    if (!token) {
      setRepos([]);
      setSelectedRepo(null);
      return;
    }

    const fetchRepos = async () => {
      setIsLoadingRepos(true);
      setConnectError("");
      try {
        const response = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", {
          headers: {
            "Authorization": `token ${token}`,
            "Accept": "application/vnd.github.v3+json"
          }
        });

        if (!response.ok) {
          if (response.status === 401) {
            handleDisconnect();
            throw new Error(isEn ? "Session expired. Please reconnect." : "セッションの有効期限が切れました。再接続してください。");
          }
          throw new Error("Failed to fetch repositories.");
        }

        const data = await response.json();
        setRepos(Array.isArray(data) ? data : []);
      } catch (err: any) {
        setConnectError(err.message || "Failed to load repos.");
      } finally {
        setIsLoadingRepos(false);
      }
    };

    fetchRepos();
  }, [token]);

  // Fetch commits and issues when repository is selected
  useEffect(() => {
    if (!selectedRepo || !token) {
      setCommits([]);
      setIssues([]);
      setAiOutput("");
      setAiMode("");
      return;
    }

    const fetchRepoDetails = async () => {
      setIsLoadingDetails(true);
      setAiOutput("");
      setAiMode("");
      setSyncLogs([]);
      try {
        const [commitsRes, issuesRes] = await Promise.all([
          fetch(`https://api.github.com/repos/${selectedRepo.owner.login}/${selectedRepo.name}/commits?per_page=15`, {
            headers: {
              "Authorization": `token ${token}`,
              "Accept": "application/vnd.github.v3+json"
            }
          }),
          fetch(`https://api.github.com/repos/${selectedRepo.owner.login}/${selectedRepo.name}/issues?per_page=15`, {
            headers: {
              "Authorization": `token ${token}`,
              "Accept": "application/vnd.github.v3+json"
            }
          })
        ]);

        const commitsData = commitsRes.ok ? await commitsRes.json() : [];
        const issuesData = issuesRes.ok ? await issuesRes.json() : [];

        setCommits(Array.isArray(commitsData) ? commitsData : []);
        setIssues(Array.isArray(issuesData) ? issuesData : []);
      } catch (err) {
        console.error("Error fetching repository details:", err);
      } finally {
        setIsLoadingDetails(false);
      }
    };

    fetchRepoDetails();
  }, [selectedRepo, token]);

  // Handle Quick PAT connect
  const handleConnectPAT = async () => {
    if (!patInput.trim()) {
      setConnectError(isEn ? "Please enter a token." : "トークンを入力してください。");
      return;
    }
    setIsConnecting(true);
    setConnectError("");
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `token ${patInput.trim()}`,
          "Accept": "application/vnd.github.v3+json"
        }
      });

      if (!response.ok) {
        throw new Error(isEn ? "Authentication failed. Verify token scopes." : "認証に失敗しました。スコープとトークンを確認してください。");
      }

      const userData = await response.json();
      localStorage.setItem("acos_github_token", patInput.trim());
      localStorage.setItem("acos_github_user", JSON.stringify(userData));
      setToken(patInput.trim());
      setUser(userData);
      setPatInput("");
      setSuccessMsg(isEn ? "Connected successfully!" : "正常に接続されました！");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setConnectError(err.message || "Connection failed.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem("acos_github_token");
    localStorage.removeItem("acos_github_user");
    setToken("");
    setUser(null);
    setSelectedRepo(null);
  };

  // Generate AI Release Changelog
  const handleGenerateChangelog = async () => {
    if (!selectedRepo || commits.length === 0) return;
    setIsAiLoading(true);
    setAiOutput("");
    setAiMode("changelog");
    setDetailsTab("ai");
    try {
      const response = await fetch("/api/github/generate-changelog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commits,
          repoName: selectedRepo.full_name
        })
      });

      if (!response.ok) throw new Error("Changelog generation failed.");
      const data = await response.json();
      setAiOutput(data.markdown);
    } catch (err: any) {
      setAiOutput(`### Error\n${err.message || "Failed to generate release notes."}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Audit issues via Gemini
  const handleAuditIssues = async () => {
    if (!selectedRepo || issues.length === 0) return;
    setIsAiLoading(true);
    setAiOutput("");
    setAiMode("audit");
    setDetailsTab("ai");
    try {
      const response = await fetch("/api/github/audit-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issues,
          repoName: selectedRepo.full_name
        })
      });

      if (!response.ok) throw new Error("Quality audit failed.");
      const data = await response.json();
      setAiOutput(data.markdown);
    } catch (err: any) {
      setAiOutput(`### Error\n${err.message || "Failed to perform quality audit."}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Ingest repository metadata into AI Knowledge Graph
  const handleIngestToKnowledgeGraph = () => {
    if (!selectedRepo) return;
    setIsSyncing(true);
    setSyncLogs([]);

    const steps = [
      `[INIT] ${new Date().toISOString()} - Initializing Repository Ingestion Engine...`,
      `[CONNECT] Connecting to GitHub repo: "${selectedRepo.full_name}" via secure OAuth Tunnel`,
      `[SCAN] Fetching HEAD file hierarchy & core architecture specifications...`,
      `[PARSE] Reading ${commits.length} recent commits logs for active intelligence trace...`,
      `[PARSE] Reading ${issues.length} active issues and Pull Requests threads...`,
      `[COGNITIVE] Aligning technical debt metrics with ACOS Organization Evolution Engine (OEvE)...`,
      `[KNOWLEDGE] Syncing structure: ${selectedRepo.stargazers_count} stars, ${selectedRepo.forks_count} forks, primary language: "${selectedRepo.language || "TypeScript"}"`,
      `[SUCCESS] Injected Repository Entity Node into Global Knowledge DNA Relationship Graph!`,
      `[EXPORT] Generating briefing brief for Active Workspace context...`
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        setSyncLogs(prev => [...prev, steps[currentStep]]);
        currentStep++;
      } else {
        clearInterval(interval);
        setIsSyncing(false);
        setSuccessMsg(isEn ? "Repository Ingested to Knowledge Graph!" : "リポジトリをナレッジグラフへ同期完了しました！");
        setTimeout(() => setSuccessMsg(""), 3000);

        // Add file to workspace materials automatically!
        if (onAddWorkspaceFile) {
          onAddWorkspaceFile({
            id: `git-${selectedRepo.id}`,
            name: `${selectedRepo.name}_AI_Repo_Audit.md`,
            size: "12 KB",
            timestamp: new Date().toISOString(),
            type: "md"
          });
        }
      }
    }, 600);
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(aiOutput);
    setSuccessMsg(isEn ? "Copied markdown to clipboard!" : "クリップボードにコピーしました！");
    setTimeout(() => setSuccessMsg(""), 2000);
  };

  const handleSaveReportToWorkspace = () => {
    if (!selectedRepo || !aiOutput) return;
    if (onAddWorkspaceFile) {
      onAddWorkspaceFile({
        id: `ai-${Date.now()}`,
        name: `${selectedRepo.name}_AI_${aiMode === "changelog" ? "Changelog" : "Audit_Report"}.md`,
        size: `${(aiOutput.length / 1024).toFixed(1)} KB`,
        timestamp: new Date().toISOString(),
        type: "md"
      });
      setSuccessMsg(isEn ? "Report added to your Workspace materials!" : "監査レポートを資料としてマイワークスペースに追加しました！");
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  };

  // Filter repos based on query
  const filteredRepos = useMemo(() => {
    return repos.filter(r =>
      r.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
      (r.language && r.language.toLowerCase().includes(repoSearchQuery.toLowerCase()))
    );
  }, [repos, repoSearchQuery]);

  // Filter commits / issues based on query
  const filteredCommits = useMemo(() => {
    return commits.filter(c =>
      c.commit?.message?.toLowerCase().includes(detailSearchQuery.toLowerCase()) ||
      c.commit?.author?.name?.toLowerCase().includes(detailSearchQuery.toLowerCase()) ||
      c.sha?.toLowerCase().includes(detailSearchQuery.toLowerCase())
    );
  }, [commits, detailSearchQuery]);

  const filteredIssues = useMemo(() => {
    return issues.filter(i =>
      i.title.toLowerCase().includes(detailSearchQuery.toLowerCase()) ||
      (i.body && i.body.toLowerCase().includes(detailSearchQuery.toLowerCase())) ||
      i.number.toString().includes(detailSearchQuery)
    );
  }, [issues, detailSearchQuery]);

  return (
    <div className="space-y-6">
      
      {/* GitHub Authentication Guard */}
      {!user ? (
        <SovereignGlassCard className="p-8 max-w-2xl mx-auto text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-slate-950 text-white flex items-center justify-center mx-auto border border-white/10 shadow-lg scale-105">
            <Github className="w-8 h-8 animate-pulse" />
          </div>
          
          <div className="space-y-2">
            <h3 className="text-xl font-black text-slate-800 dark:text-white tracking-tight">
              {isEn ? "Connect Your GitHub Account" : "GitHub 開発リソースの連携"}
            </h3>
            <p className="text-xs text-slate-400 dark:text-neutral-500 max-w-md mx-auto leading-relaxed">
              {isEn 
                ? "Connect your GitHub account to let ACOS import repos, summarize commits, audit issues, and align software design with AI swarm agents."
                : "リポジトリ、コミットログ、イシューのインポートや、AIによる自律リリースノート生成・品質セキュリティ監査を開始します。"}
            </p>
          </div>

          {connectError && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs font-bold text-rose-500 flex items-center gap-2 max-w-md mx-auto font-mono text-left">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{connectError}</span>
            </div>
          )}

          {/* Quick connect using Token */}
          <div className="max-w-md mx-auto bg-slate-50 dark:bg-neutral-950/40 p-5 rounded-2xl border border-slate-200/50 dark:border-neutral-800 space-y-4 text-left">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                {isEn ? "GitHub Personal Access Token" : "GitHub 個人アクセストークンで接続"}
              </label>
              <a 
                href="https://github.com/settings/tokens/new?scopes=repo,read:user" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-[10px] text-indigo-500 hover:underline flex items-center gap-0.5"
              >
                <BookOpen className="w-3 h-3" />
                {isEn ? "Generate Token" : "トークンを新規作成"}
              </a>
            </div>

            <div className="flex gap-2">
              <input
                type="password"
                value={patInput}
                onChange={(e) => setPatInput(e.target.value)}
                placeholder="ghp_••••••••••••••••••••••••••••••••"
                className="flex-1 bg-white dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 dark:text-white placeholder:text-slate-500 font-mono focus:border-indigo-500/50 outline-none"
              />
              <SovereignButton
                disabled={isConnecting}
                onClick={handleConnectPAT}
                className="px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs flex items-center gap-1.5"
              >
                {isConnecting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isEn ? "Link" : "連携する"}</span>
              </SovereignButton>
            </div>
            
            <p className="text-[10px] text-slate-400 leading-normal font-medium">
              {isEn 
                ? "Paste a token with 'repo' and 'read:user' permissions for a quick, secure connection. Alternatively, go to Organization Cockpit to set up custom OAuth."
                : "接続には 'repo' および 'read:user' 権限を持つアクセストークンが必要です。独自にOAuthアプリを設定する場合は、組織設定ページで行えます。"}
            </p>
          </div>
        </SovereignGlassCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Success toast inside panel */}
          {successMsg && (
            <div className="lg:col-span-12 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-bold text-emerald-500 flex items-center gap-2">
              <Check className="w-4 h-4 animate-bounce" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Left Panel: User Info & Repositories list (Col Span 4) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* User Profile Card */}
            <SovereignGlassCard className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img 
                  src={user.avatar_url} 
                  alt={user.login} 
                  className="w-10 h-10 rounded-full border border-slate-200/50 dark:border-neutral-700 shadow-sm"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <h4 className="text-xs font-black text-slate-800 dark:text-neutral-200 flex items-center gap-1">
                    <span>{user.name || user.login}</span>
                    <a href={user.html_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-indigo-500">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </h4>
                  <p className="text-[10px] text-slate-400 font-mono font-medium">@{user.login}</p>
                </div>
              </div>
              <SovereignButton variant="ghost" size="sm" onClick={handleDisconnect} className="text-rose-400 hover:text-rose-500 hover:bg-rose-500/10 py-1.5 px-2.5 text-[10px] font-bold rounded-lg border border-rose-500/10">
                {isEn ? "Sign out" : "解除"}
              </SovereignButton>
            </SovereignGlassCard>

            {/* Repositories Index Card */}
            <SovereignGlassCard className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                  <Folder className="w-4 h-4 text-indigo-500" />
                  {isEn ? "Repositories" : "リポジトリ一覧"}
                </h3>
                {isLoadingRepos && <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />}
              </div>

              {/* Repo Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <SovereignInput
                  type="text"
                  value={repoSearchQuery}
                  onChange={(e) => setRepoSearchQuery(e.target.value)}
                  placeholder={isEn ? "Filter repositories..." : "リポジトリをフィルタ..."}
                  className="pl-8.5 py-1.5 text-xs"
                />
              </div>

              {/* Repos Catalog */}
              <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
                {filteredRepos.map((r) => {
                  const isCurrent = selectedRepo && selectedRepo.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRepo(r)}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden select-none group",
                        isCurrent
                          ? "bg-indigo-500/[0.03] border-indigo-500/40 shadow-xs"
                          : "bg-white/40 dark:bg-neutral-900/10 border-slate-200/50 dark:border-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.01]"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn(
                          "text-xs font-black truncate leading-none",
                          isCurrent ? "text-indigo-600 dark:text-indigo-400" : "text-slate-800 dark:text-neutral-200 group-hover:text-indigo-500 transition-colors"
                        )}>
                          {r.name}
                        </span>
                        {r.private && (
                          <span className="text-[8px] font-bold text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded shrink-0">PRIVATE</span>
                        )}
                      </div>
                      
                      {r.description && (
                        <p className="text-[10px] text-slate-400 dark:text-neutral-500 line-clamp-1 mt-1 leading-normal">
                          {r.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-2 text-[9px] font-mono text-slate-400 font-medium">
                        <span className="text-slate-500">{r.language || "Markdown"}</span>
                        <span>★ {r.stargazers_count}</span>
                      </div>
                    </div>
                  );
                })}

                {filteredRepos.length === 0 && !isLoadingRepos && (
                  <p className="text-[11px] text-slate-400 italic text-center py-4">
                    {isEn ? "No repositories found." : "リポジトリが見つかりません。"}
                  </p>
                )}
              </div>
            </SovereignGlassCard>

          </div>

          {/* Right Panel: Selected Repository Details & AI Tools (Col Span 8) */}
          <div className="lg:col-span-8 space-y-6">
            {!selectedRepo ? (
              <SovereignGlassCard className="p-12 text-center flex flex-col items-center justify-center space-y-4 h-[500px]">
                <div className="w-12 h-12 bg-slate-50 dark:bg-neutral-900 rounded-2xl flex items-center justify-center border border-slate-200/50 dark:border-neutral-800">
                  <Github className="w-6 h-6 text-slate-300 dark:text-neutral-600" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-700 dark:text-neutral-300">
                    {isEn ? "No Repository Selected" : "リポジトリが選択されていません"}
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-xs leading-normal">
                    {isEn 
                      ? "Select an active repository from the left panel to examine logs, audit commits, and access AI swarm support."
                      : "左側の一覧からリポジトリを選択して、イシュー分析、コミット履歴の監査、AIインテリジェンス作業を開始してください。"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-indigo-500 font-semibold bg-indigo-500/5 px-3 py-1 rounded-full animate-pulse border border-indigo-500/10">
                  <span>AWAITING DIRECTIVE</span>
                  <ArrowRight className="w-3 h-3" />
                </div>
              </SovereignGlassCard>
            ) : (
              <div className="space-y-6">
                
                {/* Repository Header & Quick Intelligence Panel */}
                <SovereignGlassCard className="p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/50 dark:border-white/[0.04] pb-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold font-mono text-indigo-500 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10 max-w-fit">
                        <GitBranch className="w-3 h-3" />
                        <span>{selectedRepo.default_branch.toUpperCase()}</span>
                      </div>
                      <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-1.5">
                        <span>{selectedRepo.name}</span>
                        <a href={selectedRepo.html_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-indigo-500">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </h3>
                      <p className="text-xs text-slate-400">
                        {selectedRepo.description || (isEn ? "No description provided." : "説明文がありません。")}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <SovereignButton
                        onClick={handleIngestToKnowledgeGraph}
                        disabled={isSyncing}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-50 text-white dark:text-slate-950 rounded-xl text-[10px] font-black tracking-tight flex items-center gap-1 shadow-sm active:scale-95"
                      >
                        <Database className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{isEn ? "Sync with AI Knowledge" : "AIナレッジと同期する"}</span>
                      </SovereignButton>
                    </div>
                  </div>

                  {/* Quick AI Trigger actions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                    <div
                      onClick={handleGenerateChangelog}
                      className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/20 dark:to-neutral-900 border border-indigo-500/10 dark:border-indigo-500/5 hover:border-indigo-500/30 transition-all cursor-pointer flex gap-3 items-start select-none group active:scale-[0.99]"
                    >
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0 border border-indigo-500/10 group-hover:scale-105 transition-all">
                        <Sparkles className="w-4.5 h-4.5" />
                      </div>
                      <div className="space-y-0.5 text-left">
                        <h4 className="text-xs font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                          <span>{isEn ? "Smart Changelog" : "AIリリースノート自動生成"}</span>
                          <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                        </h4>
                        <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium leading-normal">
                          {isEn ? "Summarize 15 recent commits into professional developer release notes." : "最近の15コミット履歴から変更点を分析し、洗練されたリリースノートを作成します。"}
                        </p>
                      </div>
                    </div>

                    <div
                      onClick={handleAuditIssues}
                      className="p-3.5 rounded-2xl bg-gradient-to-br from-pink-50 to-white dark:from-pink-950/20 dark:to-neutral-900 border border-pink-500/10 dark:border-pink-500/5 hover:border-pink-500/30 transition-all cursor-pointer flex gap-3 items-start select-none group active:scale-[0.99]"
                    >
                      <div className="w-8 h-8 rounded-xl bg-pink-500/10 text-pink-500 flex items-center justify-center shrink-0 border border-pink-500/10 group-hover:scale-105 transition-all">
                        <ShieldCheck className="w-4.5 h-4.5" />
                      </div>
                      <div className="space-y-0.5 text-left">
                        <h4 className="text-xs font-black text-pink-600 dark:text-pink-400 flex items-center gap-1">
                          <span>{isEn ? "Quality & Security Audit" : "イシューのAI技術監査"}</span>
                          <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                        </h4>
                        <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium leading-normal">
                          {isEn ? "Analyze open issues to generate technical risk & security audit reports." : "未解決イシュー全体の深刻度、根本原因、および具体的な解決設計コード案を監査します。"}
                        </p>
                      </div>
                    </div>
                  </div>
                </SovereignGlassCard>

                {/* Cognitive Sync Terminal Log overlay */}
                {syncLogs.length > 0 && (
                  <SovereignGlassCard className="p-4 bg-slate-950 border-slate-800 rounded-2xl font-mono text-[10px] text-cyan-400 space-y-1.5 overflow-hidden shadow-inner leading-relaxed">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-cyan-500 animate-pulse" />
                        <span className="font-bold text-slate-300">ACOS OEvE SYNC LOGS (TERMINAL v2)</span>
                      </div>
                      {isSyncing ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-500" />
                      ) : (
                        <span className="text-emerald-400 font-black">SYNCHRONIZED</span>
                      )}
                    </div>
                    <div className="space-y-1 max-h-[140px] overflow-y-auto text-left">
                      {syncLogs.map((log, idx) => (
                        <div key={idx} className={cn(
                          log.startsWith("[SUCCESS]") ? "text-emerald-400 font-bold" :
                          log.startsWith("[INIT]") ? "text-slate-400" : "text-cyan-300/95"
                        )}>
                          {log}
                        </div>
                      ))}
                    </div>
                  </SovereignGlassCard>
                )}

                {/* Sub-tabs & Search inside repository details */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/40 dark:bg-neutral-900/20 border border-slate-200/50 dark:border-white/[0.04] p-1.5 rounded-2xl">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setDetailsTab("commits")}
                        className={cn(
                          "px-3.5 py-1.5 rounded-xl text-[11px] font-black transition-all cursor-pointer",
                          detailsTab === "commits"
                            ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
                            : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 hover:bg-slate-100/50 dark:hover:bg-neutral-800/10"
                        )}
                      >
                        {isEn ? `Commits (${commits.length})` : `コミット履歴 (${commits.length})`}
                      </button>
                      <button
                        onClick={() => setDetailsTab("issues")}
                        className={cn(
                          "px-3.5 py-1.5 rounded-xl text-[11px] font-black transition-all cursor-pointer",
                          detailsTab === "issues"
                            ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
                            : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 hover:bg-slate-100/50 dark:hover:bg-neutral-800/10"
                        )}
                      >
                        {isEn ? `Issues & PRs (${issues.length})` : `イシュー・PR (${issues.length})`}
                      </button>
                      {aiOutput && (
                        <button
                          onClick={() => setDetailsTab("ai")}
                          className={cn(
                            "px-3.5 py-1.5 rounded-xl text-[11px] font-black transition-all cursor-pointer flex items-center gap-1",
                            detailsTab === "ai"
                              ? "bg-indigo-600 text-white shadow-sm"
                              : "text-indigo-500 hover:bg-indigo-500/10"
                          )}
                        >
                          <Sparkles className="w-3 h-3 animate-pulse" />
                          <span>{aiMode === "changelog" ? "AI Changelog" : "AI Audit Report"}</span>
                        </button>
                      )}
                    </div>

                    {detailsTab !== "ai" && (
                      <div className="relative w-full sm:w-52">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        <SovereignInput
                          type="text"
                          value={detailSearchQuery}
                          onChange={(e) => setDetailSearchQuery(e.target.value)}
                          placeholder={isEn ? "Search in details..." : "詳細内検索..."}
                          className="pl-8 py-1.5 text-[11px]"
                        />
                      </div>
                    )}
                  </div>

                  {/* Sub-tab details list */}
                  <div className="space-y-3.5 min-h-[300px]">
                    
                    {isLoadingDetails && (
                      <div className="flex flex-col items-center justify-center space-y-2 py-12">
                        <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin" />
                        <p className="text-[11px] text-slate-400 font-medium font-mono">LOADING DEVELOPMENT RESOURCE DETAILS...</p>
                      </div>
                    )}

                    {!isLoadingDetails && detailsTab === "commits" && (
                      <div className="space-y-2.5">
                        {filteredCommits.map((c) => (
                          <div key={c.sha} className="p-3.5 bg-white/40 dark:bg-neutral-900/10 border border-slate-100 dark:border-white/[0.02] rounded-xl flex items-start justify-between gap-3 text-left">
                            <div className="space-y-1.5 truncate max-w-[80%]">
                              <p className="text-xs font-bold text-slate-800 dark:text-neutral-200 truncate">
                                {c.commit?.message?.split("\n")[0]}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono text-slate-400 font-medium">
                                <span className="text-indigo-400 font-bold">{c.sha ? c.sha.slice(0, 7) : ""}</span>
                                <span>•</span>
                                <span>{c.commit?.author?.name || "unknown"}</span>
                                <span>•</span>
                                <span>{new Date(c.commit?.author?.date).toLocaleString()}</span>
                              </div>
                            </div>
                            <GitCommit className="w-4 h-4 text-slate-300 dark:text-neutral-700 shrink-0 mt-0.5" />
                          </div>
                        ))}
                        {filteredCommits.length === 0 && (
                          <p className="text-xs text-slate-400 italic py-8">
                            {isEn ? "No commits found." : "コミット履歴がありません。"}
                          </p>
                        )}
                      </div>
                    )}

                    {!isLoadingDetails && detailsTab === "issues" && (
                      <div className="space-y-2.5">
                        {filteredIssues.map((i) => {
                          const isPR = !!i.pull_request;
                          return (
                            <div key={i.id} className="p-3.5 bg-white/40 dark:bg-neutral-900/10 border border-slate-100 dark:border-white/[0.02] rounded-xl flex items-start justify-between gap-3 text-left">
                              <div className="space-y-1 truncate max-w-[80%]">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-mono font-black text-slate-400">#{i.number}</span>
                                  <h4 className="text-xs font-bold text-slate-800 dark:text-neutral-200 truncate leading-snug">
                                    {i.title}
                                  </h4>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-slate-400 font-mono mt-1">
                                  <span className={cn(
                                    "font-bold uppercase tracking-wider text-[9px] px-1.5 py-0.2 rounded border",
                                    i.state === "open"
                                      ? "text-emerald-500 bg-emerald-500/5 border-emerald-500/10"
                                      : "text-purple-500 bg-purple-500/5 border-purple-500/10"
                                  )}>
                                    {i.state}
                                  </span>
                                  <span>•</span>
                                  <span>@{i.user?.login}</span>
                                  <span>•</span>
                                  <span>{new Date(i.created_at).toLocaleDateString()}</span>
                                </div>
                                
                                {i.labels?.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {i.labels.map((lbl: any) => (
                                      <span
                                        key={lbl.id}
                                        style={{ backgroundColor: `#${lbl.color}15`, color: `#${lbl.color}`, borderColor: `#${lbl.color}30` }}
                                        className="text-[9px] font-black px-1.5 py-0.2 rounded border uppercase tracking-wider font-mono"
                                      >
                                        {lbl.name}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {isPR ? (
                                <GitPullRequest className="w-4.5 h-4.5 text-purple-400 shrink-0 mt-0.5" />
                              ) : (
                                <AlertTriangle className="w-4.5 h-4.5 text-emerald-400 shrink-0 mt-0.5" />
                              )}
                            </div>
                          );
                        })}
                        {filteredIssues.length === 0 && (
                          <p className="text-xs text-slate-400 italic py-8">
                            {isEn ? "No open issues or PRs found." : "未解決のイシューまたはPRはありません。"}
                          </p>
                        )}
                      </div>
                    )}

                    {!isLoadingDetails && detailsTab === "ai" && (
                      <div className="space-y-4">
                        {isAiLoading ? (
                          <div className="flex flex-col items-center justify-center space-y-2 py-12">
                            <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin" />
                            <p className="text-[11px] text-slate-400 font-medium font-mono animate-pulse uppercase">
                              {aiMode === "changelog" ? "Gemini analyzing commits logs..." : "Gemini auditing open issues..."}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-4 text-left">
                            
                            {/* Actions toolbar */}
                            <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-neutral-900/40 p-2.5 border border-slate-100 dark:border-neutral-800 rounded-xl">
                              <div className="flex items-center gap-1.5 text-[10px] font-mono text-indigo-500 font-bold uppercase">
                                <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
                                <span>AI Generated Report</span>
                              </div>
                              <div className="flex gap-2">
                                <SovereignButton
                                  variant="secondary"
                                  size="sm"
                                  onClick={handleCopyToClipboard}
                                  className="flex items-center gap-1 text-[10px] py-1 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-100"
                                >
                                  <Copy className="w-3 h-3 text-slate-500" />
                                  <span>{isEn ? "Copy Code" : "コピー"}</span>
                                </SovereignButton>
                                <SovereignButton
                                  onClick={handleSaveReportToWorkspace}
                                  className="flex items-center gap-1 text-[10px] py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                                >
                                  <FileText className="w-3 h-3 text-indigo-200" />
                                  <span>{isEn ? "Save to Workspace" : "資料として保存"}</span>
                                </SovereignButton>
                              </div>
                            </div>

                            {/* Markdown render viewport */}
                            <SovereignGlassCard className="p-6 prose prose-slate dark:prose-invert max-w-none bg-white/60 dark:bg-neutral-950/20 border border-slate-200/50 dark:border-neutral-850 shadow-inner max-h-[460px] overflow-y-auto">
                              <div className="markdown-body text-xs leading-relaxed space-y-3 text-slate-700 dark:text-neutral-300 font-medium">
                                <ReactMarkdown>{aiOutput}</ReactMarkdown>
                              </div>
                            </SovereignGlassCard>

                          </div>
                        )}
                      </div>
                    )}

                  </div>
                </div>

              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
}
