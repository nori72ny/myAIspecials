import { AgentLifecycleState, AgentCapability, AgentPermissions, AgentHealth, AgentGovernanceRecord } from "./AgentGovernanceTypes";
import { AgentGovernanceEvents } from "./AgentGovernanceEvents";

export class AgentRegistryService {
  private static instance: AgentRegistryService;
  private registry: Map<string, AgentGovernanceRecord> = new Map();

  private constructor() {
    this.seedDefaultAgents();
  }

  public static getInstance(): AgentRegistryService {
    if (!AgentRegistryService.instance) {
      AgentRegistryService.instance = new AgentRegistryService();
    }
    return AgentRegistryService.instance;
  }

  private seedDefaultAgents(): void {
    // Seed default governance records matching the seed agents in InMemoryAgentRepository
    this.registerWithId("agent-1", "ARCHITECT", [AgentCapability.Planning, AgentCapability.Writing, AgentCapability.ToolUse], {
      allowedTools: ["WebTool", "FileTool", "CalculatorTool"],
      allowedMemory: ["mission-context", "global-facts"],
      allowedModels: ["gemini-2.5-flash", "gemini-2.5-pro"]
    }, AgentLifecycleState.Active, 8);

    this.registerWithId("agent-2", "RESEARCHER", [AgentCapability.Research, AgentCapability.Vision, AgentCapability.ToolUse], {
      allowedTools: ["WebTool"],
      allowedMemory: ["mission-context"],
      allowedModels: ["gemini-2.5-flash"]
    }, AgentLifecycleState.Active, 6);

    this.registerWithId("agent-default", "GENERAL", [AgentCapability.Writing, AgentCapability.ToolUse], {
      allowedTools: ["CalculatorTool"],
      allowedMemory: ["scratchpad"],
      allowedModels: ["gemini-2.5-flash"]
    }, AgentLifecycleState.Active, 5);
  }

  private cloneRecord(record: AgentGovernanceRecord): AgentGovernanceRecord {
    const clone = JSON.parse(JSON.stringify(record));
    clone.health.lastActivity = new Date(clone.health.lastActivity);
    return clone;
  }

  private registerWithId(
    id: string,
    role: string,
    capabilities: AgentCapability[],
    permissions: Partial<AgentPermissions>,
    initialState: AgentLifecycleState,
    priority: number = 5
  ): AgentGovernanceRecord {
    const defaultPermissions: AgentPermissions = {
      allowedTools: permissions.allowedTools || [],
      allowedMemory: permissions.allowedMemory || [],
      allowedModels: permissions.allowedModels || []
    };

    const initialHealth: AgentHealth = {
      successRate: 1.0,
      errorRate: 0.0,
      averageRuntime: 0,
      averageTokens: 0,
      lastActivity: new Date()
    };

    const record: AgentGovernanceRecord = {
      id,
      role,
      capabilities,
      state: initialState,
      permissions: defaultPermissions,
      health: initialHealth,
      priority,
      load: 0
    };

    this.registry.set(id, this.cloneRecord(record));
    AgentGovernanceEvents.getInstance().record("AgentCreated", id, { role, capabilities }, `Agent registered with ID: ${id}`);
    
    if (initialState === AgentLifecycleState.Active) {
      AgentGovernanceEvents.getInstance().record("AgentActivated", id, {}, `Agent activated with ID: ${id}`);
    }

    return this.cloneRecord(record);
  }

  public registerAgent(
    role: string,
    capabilities: AgentCapability[],
    permissions?: Partial<AgentPermissions>,
    priority: number = 5
  ): AgentGovernanceRecord {
    const id = `AGT-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
    return this.registerWithId(id, role, capabilities, permissions || {}, AgentLifecycleState.Registered, priority);
  }

  public updateAgent(id: string, updates: Partial<Omit<AgentGovernanceRecord, "id" | "health">>): AgentGovernanceRecord {
    const record = this.registry.get(id);
    if (!record) {
      throw new Error(`Agent with ID ${id} not found in governance registry.`);
    }

    const previousState = record.state;

    // Apply updates
    if (updates.role !== undefined) record.role = updates.role;
    if (updates.capabilities !== undefined) record.capabilities = updates.capabilities;
    if (updates.permissions !== undefined) record.permissions = { ...record.permissions, ...updates.permissions };
    if (updates.priority !== undefined) record.priority = updates.priority;
    if (updates.load !== undefined) record.load = updates.load;
    
    if (updates.state !== undefined && updates.state !== previousState) {
      this.setAgentStateInternal(record, updates.state);
    }

    this.registry.set(id, this.cloneRecord(record));
    return this.cloneRecord(record);
  }

  public deleteAgent(id: string): boolean {
    if (this.registry.has(id)) {
      this.registry.delete(id);
      return true;
    }
    return false;
  }

  public getAgent(id: string): AgentGovernanceRecord | null {
    const record = this.registry.get(id);
    if (!record) return null;
    return this.cloneRecord(record);
  }

  public listAgents(): AgentGovernanceRecord[] {
    return Array.from(this.registry.values()).map(r => this.cloneRecord(r));
  }

  public setAgentState(id: string, state: AgentLifecycleState): AgentGovernanceRecord {
    const record = this.registry.get(id);
    if (!record) {
      throw new Error(`Agent with ID ${id} not found in governance registry.`);
    }

    this.setAgentStateInternal(record, state);
    this.registry.set(id, this.cloneRecord(record));
    return this.cloneRecord(record);
  }

  private setAgentStateInternal(record: AgentGovernanceRecord, state: AgentLifecycleState): void {
    const previous = record.state;
    record.state = state;

    if (state === AgentLifecycleState.Active && previous !== AgentLifecycleState.Active) {
      AgentGovernanceEvents.getInstance().record("AgentActivated", record.id, { previous }, `Agent state changed to Active.`);
    } else if (state === AgentLifecycleState.Suspended && previous !== AgentLifecycleState.Suspended) {
      AgentGovernanceEvents.getInstance().record("AgentSuspended", record.id, { previous }, `Agent state suspended.`);
    } else if (state === AgentLifecycleState.Retired && previous !== AgentLifecycleState.Retired) {
      AgentGovernanceEvents.getInstance().record("AgentRetired", record.id, { previous }, `Agent retired.`);
    } else {
      // General transition
      AgentGovernanceEvents.getInstance().record("AgentCreated", record.id, { previous, current: state }, `Agent state transitioned from ${previous} to ${state}.`);
    }
  }

  public updateAgentHealth(id: string, success: boolean, runtimeMs: number, tokens: number): AgentGovernanceRecord {
    const record = this.registry.get(id);
    if (!record) {
      throw new Error(`Agent with ID ${id} not found in governance registry.`);
    }

    const health = record.health;

    // Calculate rolling average
    const weight = 0.2; // 20% weight to current execution (Exponential Moving Average)
    
    const currentSuccessRate = success ? 1.0 : 0.0;
    const currentErrorRate = success ? 0.0 : 1.0;

    health.successRate = Number(((1 - weight) * health.successRate + weight * currentSuccessRate).toFixed(4));
    health.errorRate = Number(((1 - weight) * health.errorRate + weight * currentErrorRate).toFixed(4));
    
    if (health.averageRuntime === 0) {
      health.averageRuntime = runtimeMs;
    } else {
      health.averageRuntime = Math.round((1 - weight) * health.averageRuntime + weight * runtimeMs);
    }

    if (health.averageTokens === 0) {
      health.averageTokens = tokens;
    } else {
      health.averageTokens = Math.round((1 - weight) * health.averageTokens + weight * tokens);
    }

    health.lastActivity = new Date();
    record.health = health;

    this.registry.set(id, this.cloneRecord(record));
    return this.cloneRecord(record);
  }

  public clear(): void {
    this.registry.clear();
    this.seedDefaultAgents();
  }
}
