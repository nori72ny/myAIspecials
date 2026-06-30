import { Mission, Task, Agent } from "@origin/domain";
import { MemoryPoisoningProtectionEngine, HardenedMemoryEntry } from "./security/MemoryPoisoningProtectionEngine";

// 1. Individual Memory Interfaces & Classes

export interface MemoryEntry {
  timestamp: Date;
  content: string;
  metadata?: Record<string, any>;
}

/**
 * MissionMemory: Persistent facts, logs, or milestones accumulated during a single mission.
 * This acts as the bridge for Task-to-Task memory sharing (Task間Memory共有).
 */
export class MissionMemory {
  private entries: HardenedMemoryEntry[] = [];

  public addFact(content: string, metadata?: Record<string, any>): void {
    const validation = MemoryPoisoningProtectionEngine.validateFact(content, metadata, this.entries);
    if (!validation.allowed) {
      return;
    }

    this.entries.push({
      timestamp: new Date(),
      content,
      confidence: validation.confidence,
      trustedSource: validation.trustedSource,
      expiresAt: validation.expiresAt,
      metadata
    });
  }

  public getFacts(): MemoryEntry[] {
    const now = new Date();
    // Filter out expired facts and return map complying with backward compatibility
    return this.entries
      .filter(e => !e.expiresAt || e.expiresAt > now)
      .map(e => ({
        timestamp: e.timestamp,
        content: e.content,
        metadata: {
          ...e.metadata,
          confidence: e.confidence,
          trustedSource: e.trustedSource,
          expiresAt: e.expiresAt
        }
      }));
  }

  public clear(): void {
    this.entries = [];
  }
}

/**
 * TaskMemory: Context, inputs, or execution summaries for individual tasks.
 */
export class TaskMemory {
  private outputs: Map<string, string> = new Map(); // taskId -> output

  public recordTaskOutput(taskId: string, output: string): void {
    this.outputs.set(taskId, output);
  }

  public getTaskOutput(taskId: string): string | undefined {
    return this.outputs.get(taskId);
  }

  public getAllOutputs(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, val] of this.outputs.entries()) {
      obj[key] = val;
    }
    return obj;
  }

  public clear(): void {
    this.outputs.clear();
  }
}

/**
 * Scratchpad: Ephemeral short-term scratch notes for intermediate thoughts or tools.
 */
export class Scratchpad {
  private notes: string[] = [];

  public write(note: string): void {
    this.notes.push(note);
  }

  public read(): string[] {
    return [...this.notes];
  }

  public clear(): void {
    this.notes = [];
  }
}

/**
 * ExecutionContextMemory: Environment configuration variables or runtime parameters.
 */
export class ExecutionContextMemory {
  private vars: Map<string, any> = new Map();

  public set(key: string, value: any): void {
    this.vars.set(key, value);
  }

  public get<T>(key: string): T | undefined {
    return this.vars.get(key) as T;
  }

  public clear(): void {
    this.vars.clear();
  }
}

/**
 * ConversationMemory: Dialog history of interactive turns between agent and user/coordinator.
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export class ConversationMemory {
  private messages: ChatMessage[] = [];

  public addMessage(role: "user" | "assistant" | "system", content: string): void {
    this.messages.push({ role, content, timestamp: new Date() });
  }

  public getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  public clear(): void {
    this.messages = [];
  }
}

/**
 * AgentScratchpad: Local memory representing the internal thoughts and logic of the agent during the task.
 */
export class AgentScratchpad {
  private steps: string[] = [];

  public logStep(thought: string): void {
    this.steps.push(thought);
  }

  public getSteps(): string[] {
    return [...this.steps];
  }

  public clear(): void {
    this.steps = [];
  }
}

// 2. MemoryManager: Singleton orchestrator for Version 1
export class MemoryManager {
  private static instance: MemoryManager;

  // Compartments indexed by missionId
  private missionCompartments: Map<string, MissionMemory> = new Map();
  private taskCompartments: Map<string, TaskMemory> = new Map();
  private scratchpadCompartments: Map<string, Scratchpad> = new Map();
  private contextCompartments: Map<string, ExecutionContextMemory> = new Map();
  private conversationCompartments: Map<string, Map<string, ConversationMemory>> = new Map(); // missionId -> (agentId -> ConversationMemory)
  private agentScratchpadCompartments: Map<string, Map<string, AgentScratchpad>> = new Map(); // missionId -> (taskId -> AgentScratchpad)

  private constructor() {}

  public static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  public getMissionMemory(missionId: string): MissionMemory {
    if (!this.missionCompartments.has(missionId)) {
      this.missionCompartments.set(missionId, new MissionMemory());
    }
    return this.missionCompartments.get(missionId)!;
  }

  public getTaskMemory(missionId: string): TaskMemory {
    if (!this.taskCompartments.has(missionId)) {
      this.taskCompartments.set(missionId, new TaskMemory());
    }
    return this.taskCompartments.get(missionId)!;
  }

  public getScratchpad(missionId: string): Scratchpad {
    if (!this.scratchpadCompartments.has(missionId)) {
      this.scratchpadCompartments.set(missionId, new Scratchpad());
    }
    return this.scratchpadCompartments.get(missionId)!;
  }

  public getExecutionContextMemory(missionId: string): ExecutionContextMemory {
    if (!this.contextCompartments.has(missionId)) {
      this.contextCompartments.set(missionId, new ExecutionContextMemory());
    }
    return this.contextCompartments.get(missionId)!;
  }

  public getConversationMemory(missionId: string, agentId: string): ConversationMemory {
    if (!this.conversationCompartments.has(missionId)) {
      this.conversationCompartments.set(missionId, new Map());
    }
    const agentMap = this.conversationCompartments.get(missionId)!;
    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, new ConversationMemory());
    }
    return agentMap.get(agentId)!;
  }

  public getAgentScratchpad(missionId: string, taskId: string): AgentScratchpad {
    if (!this.agentScratchpadCompartments.has(missionId)) {
      this.agentScratchpadCompartments.set(missionId, new Map());
    }
    const taskMap = this.agentScratchpadCompartments.get(missionId)!;
    if (!taskMap.has(taskId)) {
      taskMap.set(taskId, new AgentScratchpad());
    }
    return taskMap.get(taskId)!;
  }

  /**
   * Clears/Discards all memory blocks associated with a specific mission.
   * Fulfills "Mission終了時Memory破棄"
   */
  public discardMissionMemory(missionId: string): void {
    this.missionCompartments.delete(missionId);
    this.taskCompartments.delete(missionId);
    this.scratchpadCompartments.delete(missionId);
    this.contextCompartments.delete(missionId);
    this.conversationCompartments.delete(missionId);
    this.agentScratchpadCompartments.delete(missionId);
  }

  public clearAll(): void {
    this.missionCompartments.clear();
    this.taskCompartments.clear();
    this.scratchpadCompartments.clear();
    this.contextCompartments.clear();
    this.conversationCompartments.clear();
    this.agentScratchpadCompartments.clear();
  }
}

// 3. ContextResolver: Extracts and formats textual context lists based on keys or current active states
export class ContextResolver {
  public static resolveContext(missionId: string, taskId: string, agentId: string): string[] {
    const manager = MemoryManager.getInstance();
    const contextList: string[] = [];

    // Retrieve and append all facts from the active MissionMemory
    const missionMemory = manager.getMissionMemory(missionId);
    const facts = missionMemory.getFacts();
    if (facts.length > 0) {
      contextList.push("--- [MISSION MEMORY FACTS] ---");
      facts.forEach((f, idx) => {
        contextList.push(`[Fact ${idx + 1}] ${f.content}`);
      });
    }

    // Retrieve and append outputs from previous tasks (Task-to-Task sharing)
    const taskMemory = manager.getTaskMemory(missionId);
    const taskOutputs = taskMemory.getAllOutputs();
    const taskKeys = Object.keys(taskOutputs);
    if (taskKeys.length > 0) {
      contextList.push("--- [PREVIOUS TASK OUTPUTS (TASK MEMORY)] ---");
      taskKeys.forEach(tId => {
        if (tId !== taskId) {
          contextList.push(`[Task ${tId} Output] ${taskOutputs[tId]}`);
        }
      });
    }

    // Retrieve active AgentScratchpad steps
    const agentScratchpad = manager.getAgentScratchpad(missionId, taskId);
    const steps = agentScratchpad.getSteps();
    if (steps.length > 0) {
      contextList.push("--- [AGENT SCRATCHPAD INTERNAL STEPS] ---");
      steps.forEach((s, idx) => {
        contextList.push(`[Step ${idx + 1}] ${s}`);
      });
    }

    // Retrieve short-term generic Scratchpad contents
    const scratchpad = manager.getScratchpad(missionId);
    const notes = scratchpad.read();
    if (notes.length > 0) {
      contextList.push("--- [EPHEMERAL SCRATCHPAD NOTES] ---");
      notes.forEach((n, idx) => {
        contextList.push(`[Note ${idx + 1}] ${n}`);
      });
    }

    // Retrieve conversation thread history
    const conversation = manager.getConversationMemory(missionId, agentId);
    const history = conversation.getHistory();
    if (history.length > 0) {
      contextList.push("--- [CONVERSATION HISTORY] ---");
      history.forEach((msg) => {
        contextList.push(`[${msg.role.toUpperCase()}] ${msg.content}`);
      });
    }

    return contextList;
  }
}
