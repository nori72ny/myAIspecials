import { OrganizationState } from "../organization/OrganizationTypes";

export interface Prediction {
  workload: number;
  bottlenecks: string[];
  costs: number;
  risks: string[];
  departmentUtilization: Record<string, number>;
  successProbability: number;
  expectedROI: number;
  expectedQuality: number;
  confidenceScore: number;
}

export interface SimulationPlan {
  id: string;
  name: string;
  costEstimate: number;
  durationEstimate: number;
  riskScore: number;
  successRate: number;
  resourceUsage: Record<string, number>;
  isRecommended?: boolean;
}

export interface Scenario {
  type: "BEST" | "EXPECTED" | "WORST";
  description: string;
  probability: number;
  impactScore: number;
}

export interface CorporateGoal {
  id: string;
  level: "LONG_TERM" | "QUARTER" | "DEPARTMENT" | "AGENT";
  targetId?: string;
  description: string;
  targetMetrics: Record<string, number>;
  currentProgress: number;
}

export interface RiskMission {
  id: string;
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  targetArea: string;
}

export interface InnovationProposal {
  id: string;
  title: string;
  type: "WORKFLOW" | "ROUTING" | "PROMPT" | "COLLABORATION" | "DEPARTMENT" | "CAPABILITY";
  description: string;
  expectedImpact: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

export interface StrategicDecision {
  id: string;
  action: string;
  reason: string;
  evidence: string[];
  expectedImpact: string;
  confidence: number;
  alternatives: string[];
  timestamp: Date;
}
