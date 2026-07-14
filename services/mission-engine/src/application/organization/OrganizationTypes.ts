export enum OrgRole {
  CEO = "CEO",
  BOARD = "BOARD",
  CHIEF = "CHIEF",
  DIRECTOR = "DIRECTOR",
  MANAGER = "MANAGER",
  WORKER = "WORKER"
}

export enum OrgDepartment {
  Engineering = "Engineering",
  Research = "Research",
  Content = "Content",
  Administration = "Administration"
}

export enum OrgExecutionState {
  MISSION_RECEIVED = "MISSION_RECEIVED",
  BOARD_DISTRIBUTED = "BOARD_DISTRIBUTED",
  CHIEF_DISTRIBUTED = "CHIEF_DISTRIBUTED",
  DIRECTOR_DISTRIBUTED = "DIRECTOR_DISTRIBUTED",
  MANAGER_DISTRIBUTED = "MANAGER_DISTRIBUTED",
  WORKER_ASSIGNED = "WORKER_ASSIGNED",
  DELIVERABLE_COLLECTED = "DELIVERABLE_COLLECTED",
  MANAGER_REVIEWING = "MANAGER_REVIEWING",
  DIRECTOR_REVIEWING = "DIRECTOR_REVIEWING",
  CHIEF_REVIEWING = "CHIEF_REVIEWING",
  BOARD_APPROVING = "BOARD_APPROVING",
  CEO_SUBMITTING = "CEO_SUBMITTING",
  COMPLETED = "COMPLETED",
  ESCALATED = "ESCALATED",
  FAILED = "FAILED",
  AWAITING_HUMAN_APPROVAL = "AWAITING_HUMAN_APPROVAL",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  APPROVAL_TIMED_OUT = "APPROVAL_TIMED_OUT"
}

export interface Task {
  id: string;
  missionId: string;
  title: string;
  description: string;
  requiredCapability: string;
  priority: number; // 1-10
  department: OrgDepartment;
  status: "Pending" | "Assigned" | "In_Progress" | "Completed" | "Review" | "Escalated";
  assignedAgentId?: string;
  delegatedFromAgentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Deliverable {
  id: string;
  taskId: string;
  content: string;
  authorAgentId: string;
  version: number;
  createdAt: Date;
  metadata?: {
    evidence?: string;
    routing?: {
      selectedModelId: string;
      score: number;
      reason: string;
    };
  };
}

export enum ReviewStatus {
  APPROVED = "APPROVED",
  REJECTED = "REJECTED"
}

export interface Review {
  id: string;
  deliverableId: string;
  reviewerAgentId: string;
  score: number; // 1-100
  feedback: string;
  status: ReviewStatus;
  createdAt: Date;
}

export interface ConsensusOpinion {
  agentId: string;
  argument: string;
  score: number;
  approved: boolean;
}

export interface ConsensusRound {
  id: string;
  deliverableId: string;
  proposals: ConsensusOpinion[];
  finalVerdict: ReviewStatus;
  rational: string;
  resolvedAt: Date;
}

export interface EscalationRecord {
  id: string;
  orgId: string;
  taskId: string;
  fromAgentId: string;
  toRole: OrgRole;
  toAgentId?: string;
  reason: string;
  timestamp: Date;
  resolved: boolean;
  resolutionNote?: string;
}

export interface DepartmentMetrics {
  productivity: number;     // Tasks completed per unit of time
  reviewQuality: number;    // Average score/alignment of reviews
  successRate: number;      // Completed vs Failed (0.0 to 1.0)
  failureRate: number;      // Failed vs Total (0.0 to 1.0)
  averageTime: number;      // Milliseconds to complete task
  improvementRate: number;  // Review feedback resolution speed & score delta
}

export interface OrganizationState {
  orgId: string;
  missionId: string;
  currentState: OrgExecutionState;
  activeTasks: Task[];
  deliverables: Deliverable[];
  reviews: Review[];
  escalations: EscalationRecord[];
  consensusRounds: ConsensusRound[];
  departments: Record<OrgDepartment, string[]>; // agent IDs by department
  roleMapping: Record<string, OrgRole>;          // agent ID -> role
  updatedAt: Date;
  // Extended ACOS 2.0 specs
  aiWorkers?: CorporateAIWorker[];
  toolCapabilities?: ToolCapability[];
  teamFormation?: Record<string, string[]>;      // Team Name -> Agent IDs
  humanApprovals?: HumanApprovalRequest[];
  selfOptimizationLog?: string[];
}

export interface CorporateAIWorker {
  id: string;
  name: string;
  provider: string; // "OpenAI" | "Gemini" | "Claude" | "DeepSeek" etc.
  expertise: string[];
  speed: number; // 1-100 score
  quality: number; // 1-100 score
  cost: number; // USD per 1M tokens
  contextWindow: number; // integer
  historyCount: number;
  successRate: number; // 0.0 to 1.0
  status: "Idle" | "Busy" | "Offline";
}

export interface ToolCapability {
  id: string;
  name: string; // "Filesystem" | "Browser" | "Python" etc.
  category: "FileSystem" | "Automation" | "Communication" | "Development" | "Runtime";
  successRate: number;
  lastUsed: Date;
  activeWorkersCount: number;
}

export interface HumanApprovalRequest {
  id: string;
  orgId: string;
  taskId: string;
  requestingAgentId: string;
  role: OrgRole;
  description: string;
  status: "AWAITING_HUMAN_APPROVAL" | "APPROVED" | "REJECTED" | "APPROVAL_TIMED_OUT" | "Pending" | "Approved" | "Overridden" | "Rejected";
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  notes?: string;
}

export interface MissionMemoryRecord {
  missionId: string;
  objective: string;
  orgId: string;
  tasks: Task[];
  deliverables: Deliverable[];
  reviews: Review[];
  consensusRounds: ConsensusRound[];
  escalations: EscalationRecord[];
  success: boolean;
  metrics: any;
  improvements: string[];
  selfOptimized: boolean;
  savedAt: Date;
}

