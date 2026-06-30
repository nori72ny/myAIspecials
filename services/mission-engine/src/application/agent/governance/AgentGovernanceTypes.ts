export enum AgentLifecycleState {
  Draft = "Draft",
  Registered = "Registered",
  Active = "Active",
  Busy = "Busy",
  Suspended = "Suspended",
  Disabled = "Disabled",
  Retired = "Retired"
}

export enum AgentCapability {
  Writing = "Writing",
  Coding = "Coding",
  Research = "Research",
  Vision = "Vision",
  Planning = "Planning",
  ToolUse = "Tool Use"
}

export interface AgentPermissions {
  allowedTools: string[];
  allowedMemory: string[];
  allowedModels: string[];
}

export interface AgentHealth {
  successRate: number;      // Ratio: 0.0 to 1.0 (e.g. 0.95 = 95%)
  errorRate: number;        // Ratio: 0.0 to 1.0
  averageRuntime: number;   // milliseconds
  averageTokens: number;    // token count
  lastActivity: Date;
}

export interface AgentGovernanceRecord {
  id: string;
  role: string;
  capabilities: AgentCapability[];
  state: AgentLifecycleState;
  permissions: AgentPermissions;
  health: AgentHealth;
  priority: number;        // Higher value represents higher execution priority (e.g. 1-10)
  load: number;            // Current load / parallel task execution count (e.g. 0, 1, 2)
}
