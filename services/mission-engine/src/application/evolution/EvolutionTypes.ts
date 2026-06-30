import { Task, Deliverable, Review, ConsensusRound, OrgDepartment, OrgRole, CorporateAIWorker } from "../organization/OrganizationTypes";

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
