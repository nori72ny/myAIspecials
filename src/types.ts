export interface TaskTemplate {
  id: string;
  name: string;
  placeholder: string;
  hint: string;
}

export interface WorkspaceCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  accentColor: string;
  templates: TaskTemplate[];
}

export interface Settings {
  autoRoute: boolean;
  selectedAgents: string[]; // List of active agent IDs, e.g. ['gemini', 'openai']
  language: "ja" | "en";
}

export interface AIAgentConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "active" | "planned";
  provider: string;
}

// --- Mission Control Complete 2035 Specifications ---

export interface MissionDetail {
  id: string; // Mission ID (一意ID)
  name: string; // Mission Name (目的名称)
  goal: string; // Mission Goal (最終ゴール)
  purpose: string; // 真の目的
  conditions: string[]; // Success Definition (成功条件)
  priority: "HIGH" | "MEDIUM" | "LOW"; // Priority (重要度)
  deadline: string; // Deadline (期限)
  estimatedTime: string; // Estimated Time (予想時間)
  difficulty: "HARD" | "MEDIUM" | "EASY"; // Difficulty (難易度)
  requiredAI: string[]; // Required AI (利用AI)
  requiredAgents: string[]; // Required Agents (必要Agent)
  knowledgeSources: string[]; // Knowledge Sources (必要知識)
  requiredFiles: string[]; // Required Files (必要ファイル)
  expectedOutput: string; // Expected Output (成果物)
  outputFormat: "PDF" | "PPT" | "WEB" | "APP" | "VIDEO" | "IMAGE" | "DOCUMENT"; // Output Format (成果物形式)
  qualityThreshold: string; // Quality Threshold (品質基準)
  truthScore: number; // Truth Score (真実性)
  confidenceScore: number; // Confidence Score (信頼度)
  roiPrediction: string; // ROI Prediction (期待利益)
  risk: string; //想定リスク
  workflow: string[]; // Workflow (自動生成)
  status: "Planning" | "Running" | "Review" | "Completed"; // Status (ステータス)
  learning: string; // Learning (Knowledge DNAへ保存)
}

export interface AIMeetingMember {
  aiName: string;
  role: string;
  opinion: string;
  subAgents?: string[];
  status?: string;
}

export interface TruthEngineData {
  officialConfirmation: string;
  citationRate: number; // 0-100
  aiAgreementRate: number; // 0-100
  hallucinationCheck: string;
}

export interface QualityEngineData {
  accuracy: number; // 0-100
  confidence: number; // 0-100
  reliability: number; // 0-100
  freshness: number; // 0-100
  coverage: number; // 0-100
  reasoningDepth: number; // 0-100
}

export interface ComparisonTableRow {
  item: string;
  ourPlan: string;
  competitors: string;
}

export interface TimelinePhase {
  phase: string;
  actions: string[];
  duration: string;
}

export interface NetworkNode {
  id: string;
  label: string;
  type: string;
  connections: string[];
}

export interface ResultVisuals {
  title: string;
  subtitle: string;
  executiveSummary: string;
  comparisonTable: ComparisonTableRow[];
  timeline: TimelinePhase[];
  networkNodes: NetworkNode[];
  visualizationChart: {
    title: string;
    data: { name: string; value: number }[];
  };
}

export interface SuccessPredictionData {
  successRate: number; // 0-100
  roi: string;
  risks: string[];
  improvements: string[];
}

export interface FutureRecommendation {
  title: string;
  description: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
}

export interface OutcomeObject {
  outcomeId: string;          // Outcome ID
  missionId: string;          // Mission ID
  expectedOutcome: string;    // 期待成果
  actualOutcome: string;      // 実際成果
  gap: string;                // 差分
  roi: string;                // 利益
  timeSaved: string;          // 削減時間
  qualityScore: number;       // 品質 (0-100)
  confidence: number;         // 信頼度 (0-100)
  evidence: string;           // 証拠
  userSatisfaction: number;   // 満足度 (0-100)
  businessImpact: string;     // 事業への影響
  learningScore: number;      // 学習価値 (0-100)
  dnaUpdate: string;          // Knowledge DNA更新
}

export interface AnalysisResult {
  // 1. Header & Metadata
  successScore: number;
  aiStatus: string;

  // 2. Mission
  mission: MissionDetail;

  // 3. AI Thinking
  thinkingLogs: string[];

  // 4. Research
  research: {
    sources: string[];
    progressLogs: string[];
  };

  // 5. AI Meeting
  aiMeeting: AIMeetingMember[];

  // 6. Truth Engine
  truthEngine: TruthEngineData;

  // 7. Quality Engine
  qualityEngine: QualityEngineData;

  // 8. Result
  result: ResultVisuals;

  // 9. Success Prediction
  successPrediction: SuccessPredictionData;

  // 11. Future Recommendations
  futureRecommendations: FutureRecommendation[];

  // 12. Outcome Intelligence Engine (Build 005)
  outcome?: OutcomeObject;

  // 13. Intelligence Memory Network (Build 006)
  imn?: IntelligenceMemoryNetwork;

  // 14. Intelligence Personality Framework (Build 007)
  ipf?: IntelligencePersonalityFramework;

  // 15. ORIGIN Constitution (Build 008)
  constitution?: OriginConstitution;

  // 16. ORIGIN Quality Bible (Build 009)
  qualityBible?: OriginQualityBible;

  // 17. ORIGIN Thinking Bible (Build 010)
  thinkingBible?: OriginThinkingBible;

  // 18. ORIGIN Experience Bible (Build 011)
  experienceBible?: OriginExperienceBible;

  // 19. ORIGIN Design System (Build 012)
  designSystem?: OriginDesignSystem;

  // 20. ORIGIN Proactive Intelligence Engine (PIE)
  proactiveIntelligenceEngine?: OriginProactiveIntelligenceEngine;

  // 21. ORIGIN Blueprint 001 (Home Screen Specification)
  originBlueprint?: OriginBlueprint;

  // 22. ORIGIN Core Specification (Version 1.0)
  originCoreSpecification?: OriginCoreSpecification;

  // 23. ORIGIN System Architecture Bible (Version 1.0)
  originSystemArchitectureBible?: OriginSystemArchitectureBible;

  // 24. ORIGIN Mission Engine Specification (Document 001)
  originMissionEngineSpec?: OriginMissionEngineSpec;

  // 25. ORIGIN Kernel Specification (Version 1.0)
  originKernelSpec?: OriginKernelSpec;

  // 26. AI Evaluation Framework (OAEF)
  originAiEvaluationFramework?: OriginAiEvaluationFramework;

  // 27. Mission Success Engine (MSE)
  originMissionSuccessEngineSpec?: OriginMissionSuccessEngine;
}

export interface OriginMissionSuccessEngine {
  mission: string;
  steps: {
    number: number;
    title: string;
    description: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  }[];
  postMission: {
    successRate: number;
    improvements: string[];
    reusableKnowledge: string[];
  };
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginAiEvaluationFramework {
  mission: string;
  categories: {
    id: string;
    name: string;
    metrics: string[];
  }[];
  evaluatedModels: {
    modelName: string;
    overallEvaluation: "Gold" | "Silver" | "Bronze" | "Review Required";
    scores: {
      categoryName: string;
      scoreValue: number;
    }[];
    missionSuccessRate: {
      domain: string;
      successRate: number;
    }[];
    advantage: string;
  }[];
  updates: {
    daily: string;
    weekly: string;
    monthly: string;
  };
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginKernelSpec {
  version: string;
  mission: string;
  modules: string[];
  priority: string[];
  rule: string;
  state: string[];
  event: string[];
  principle: string;
}

export interface OriginMissionEngineSpec {
  documentId: string;
  title: string;
  purpose: string;
  inputs: string[];
  output: string;
  missionObject: string[];
  validation: string;
  successCondition: string;
  failureCondition: string;
  api: string[];
  performance: string;
  security: string;
  logging: string;
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginSystemArchitectureBible {
  version: string;
  mission: string;
  layers: {
    number: number;
    name: string;
    components: string[];
  }[];
  coreRule: string;
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginCoreSpecification {
  version: string;
  mission: string;
  chapters: {
    number: number;
    title: string;
    description: string;
  }[];
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginBlueprint {
  id: string;
  name: string;
  mission: string;
  sections: {
    number: number;
    title: string;
    details: string[];
  }[];
  uiRule: string[];
  uxRule: string[];
  designRule: string[];
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginProactiveIntelligenceEngine {
  build: string;
  mission: string;
  triggers: string[];
  action: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  notification: string;
  suggestions: string[];
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginDesignSystem {
  version: string;
  mission: string;
  philosophy: string[];
  rules: {
    category: "Visual Identity" | "Color Rules" | "Typography" | "Spacing" | "Corner Radius" | "Shadow" | "Animation" | "Interaction" | "Information" | "Mission First";
    description: string;
    details: string[];
  }[];
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginExperienceBible {
  version: string;
  mission: string;
  timeline: {
    phase: string;
    description: string;
    status: "ACHIEVED" | "PROJECTED";
    userFeeling: string;
  }[];
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginThinkingBible {
  version: string;
  mission: string;
  pipeline: {
    step: number;
    name: string;
    description: string;
    elements: string[];
    status: "COMPLETED" | "SKIPPED" | "IN_PROGRESS";
    outputLog: string;
  }[];
  finalRule: {
    title: string;
    description: string;
    isFollowed: boolean;
  };
}

export interface OriginQualityBible {
  version: string;
  qualityLevel: "Q0" | "Q1" | "Q2" | "Q3" | "Q4" | "Q5";
  q5Conditions: {
    category: "Accuracy" | "Evidence" | "Hallucination" | "Mission Success" | "UI" | "UX" | "Performance" | "Accessibility" | "Security" | "Learning";
    requirement: string;
    actualScore: string | number;
    status: "PASSED" | "WARNING" | "CRITICAL";
    auditLog: string;
  }[];
  finalRule: {
    title: string;
    status: "PASSED";
    description: string;
  };
  auditSummary: {
    overallLevel: "Q5" | "Q4" | "Q3" | "Q2" | "Q1" | "Q0";
    isReleased: boolean;
    criticalIssues: number;
    warningIssues: number;
    qualityPercentage: number;
  };
}

export interface OriginConstitution {
  version: string;
  nonNegotiablePrinciples: {
    ruleNum: number;
    title: string;
    description: string;
    complianceStatus: "PASSED" | "EXEMPT";
    howComplied: string;
  }[];
  finalRule: {
    title: string;
    complianceStatus: "PASSED";
    description: string;
  };
  auditSummary: {
    totalRulesEvaluated: number;
    rulesPassed: number;
    trustScore: number;
    isConstitutional: boolean;
  };
}

export interface IntelligencePersonalityFramework {
  factVsSpeculation: {
    facts: string[];
    speculations: string[];
    evidenceLevel: "STRONG" | "MEDIUM" | "WEAK";
    evidenceNotes: string;
  };
  optimalSolution: {
    userExpectation: string;
    optimalProposal: string;
    successProbability: number;
    successReasoning: string;
  };
  extraValue: string;
  optionsComparison: {
    optionA: string;
    optionB: string;
    comparisonMatrix: string;
    selectedBest: string;
  };
  keyRisks: string[];
  timeEfficiencyNote: string;
}

export interface IMNNode {
  id: string;
  label: string;
  type: "人" | "Vision" | "Goal" | "Mission" | "Outcome" | "Learning" | "DNA" | "Project" | "Success" | "Failure" | "Interest" | "Skill" | "Business" | "Knowledge" | "Relationship" | "Preference" | "Decision" | "Files" | "Web";
  description: string;
}

export interface IMNLink {
  source: string;
  target: string;
  label?: string;
}

export interface IntelligenceMemoryNetwork {
  nodes: IMNNode[];
  links: IMNLink[];
}

