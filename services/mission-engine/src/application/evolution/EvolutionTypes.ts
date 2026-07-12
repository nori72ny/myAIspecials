import { Task, Deliverable, Review, ConsensusRound, OrgDepartment, OrgRole, CorporateAIWorker } from "../organization/OrganizationTypes";

export interface IntelligenceDNA {
  missionId: string;
  timestamp: string;
  summary: {
    objective: string;     // 目的
    result: string;        // 結果
    successRate: number;   // 成功率
  };
  lessonsLearned: {
    successFactors: string[];  // 成功要因
    failureFactors: string[];  // 失敗要因
    improvementPoints: string[]; // 改善点
  };
  reusableKnowledge: {
    reusableConcepts: string[];  // 再利用可能な知識
    templates: string[];         // テンプレート化できる内容
    workflows: string[];         // Workflow化できる内容
  };
  userPreference: {
    inferredTendency: string[];   // 今回推測できたユーザー傾向
    nextTimeImprovements: string[]; // 次回改善点
  };
  systemImprovement: {
    aiRoutingImprovement: string;  // AI Routing改善
    pluginImprovement: string;     // Plugin改善
    workflowImprovement: string;   // Workflow改善
    memoryImprovement: string;     // Memory改善
  };
}

export interface OrganizationalMemory {
  id: string;
  missionId: string;
  success: boolean;
  score: number;
  successStories: string[];
  failureStories: string[];
  improvements: string[];
  kpiSnapshot: Record<string, any>;
  timestamp: Date;
  intelligenceDNA?: IntelligenceDNA;
}

export interface AgentRelation {
  sourceAgentId: string;
  targetAgentId: string;
  relationType: "COLLABORATION" | "REVIEW" | "DELEGATION";
  trustScore: number; // 0 to 100
  successCount: number;
  totalCount: number;
}

export interface AgentNode {
  agentId: string;
  expertise: string[];
  successRate: number;
  workload: number;
}

export interface ExecutiveDecision {
  id: string;
  type: "REORGANIZE" | "STRATEGY_SHIFT" | "RESOURCE_ALLOCATION" | "CAPABILITY_UPDATE";
  description: string;
  approvedBy: string;
  executedAt: Date;
}
