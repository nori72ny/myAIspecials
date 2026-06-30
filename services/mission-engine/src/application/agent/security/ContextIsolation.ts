import { Mission, Task, Agent } from "@origin/domain";

export interface ISystemContext {
  readonly agent: Readonly<Agent>;
  readonly systemRules: string;
}

export interface IUserContext {
  readonly customInstructions: string;
  readonly chatHistory: ReadonlyArray<{ role: string; content: string }>;
}

export interface IMissionContext {
  readonly objective: string;
  readonly successCriteria: ReadonlyArray<string>;
  readonly task: Readonly<Task>;
}

export interface IMemoryContext {
  readonly persistentFacts: ReadonlyArray<{ content: string; confidence: number; expiresAt?: Date }>;
  readonly dynamicScratchpad: ReadonlyArray<string>;
}

export interface IToolContext {
  readonly executedCalls: ReadonlyArray<{ toolName: string; input: any; result: string }>;
}

export interface IReflectionContext {
  readonly scores: ReadonlyArray<number>;
  readonly feedbackHistory: ReadonlyArray<string>;
}

export class IsolatedCompartmentManager {
  private systemContext!: ISystemContext;
  private userContext!: IUserContext;
  private missionContext!: IMissionContext;
  private memoryContext!: IMemoryContext;
  private toolContext!: IToolContext;
  private reflectionContext!: IReflectionContext;

  constructor(
    agent: Agent,
    systemRules: string,
    customInstructions: string,
    chatHistory: { role: string; content: string }[],
    mission: Mission,
    task: Task,
    persistentFacts: { content: string; confidence: number; expiresAt?: Date }[],
    dynamicScratchpad: string[],
    executedCalls: { toolName: string; input: any; result: string }[],
    scores: number[],
    feedbackHistory: string[]
  ) {
    this.updateSystemContext(agent, systemRules);
    this.updateUserContext(customInstructions, chatHistory);
    this.updateMissionContext(mission, task);
    this.updateMemoryContext(persistentFacts, dynamicScratchpad);
    this.updateToolContext(executedCalls);
    this.updateReflectionContext(scores, feedbackHistory);
  }

  // Setters perform defensive deep copies to enforce isolation
  public updateSystemContext(agent: Agent, systemRules: string): void {
    this.systemContext = {
      agent: JSON.parse(JSON.stringify(agent)),
      systemRules: String(systemRules)
    };
  }

  public updateUserContext(customInstructions: string, chatHistory: { role: string; content: string }[]): void {
    this.userContext = {
      customInstructions: String(customInstructions),
      chatHistory: chatHistory.map(h => ({ role: String(h.role), content: String(h.content) }))
    };
  }

  public updateMissionContext(mission: Mission, task: Task): void {
    this.missionContext = {
      objective: String(mission.objective),
      successCriteria: [...mission.successCriteria],
      task: JSON.parse(JSON.stringify(task))
    };
  }

  public updateMemoryContext(
    persistentFacts: { content: string; confidence: number; expiresAt?: Date }[],
    dynamicScratchpad: string[]
  ): void {
    this.memoryContext = {
      persistentFacts: persistentFacts.map(f => ({
        content: String(f.content),
        confidence: Number(f.confidence),
        expiresAt: f.expiresAt ? new Date(f.expiresAt.getTime()) : undefined
      })),
      dynamicScratchpad: [...dynamicScratchpad]
    };
  }

  public updateToolContext(executedCalls: { toolName: string; input: any; result: string }[]): void {
    this.toolContext = {
      executedCalls: executedCalls.map(c => ({
        toolName: String(c.toolName),
        input: JSON.parse(JSON.stringify(c.input)),
        result: String(c.result)
      }))
    };
  }

  public updateReflectionContext(scores: number[], feedbackHistory: string[]): void {
    this.reflectionContext = {
      scores: [...scores],
      feedbackHistory: [...feedbackHistory]
    };
  }

  // Getters return deep copies or read-only access to prevent cross-modification
  public getSystemContext(): ISystemContext {
    return JSON.parse(JSON.stringify(this.systemContext));
  }

  public getUserContext(): IUserContext {
    return JSON.parse(JSON.stringify(this.userContext));
  }

  public getMissionContext(): IMissionContext {
    return JSON.parse(JSON.stringify(this.missionContext));
  }

  public getMemoryContext(): IMemoryContext {
    return JSON.parse(JSON.stringify(this.memoryContext));
  }

  public getToolContext(): IToolContext {
    return JSON.parse(JSON.stringify(this.toolContext));
  }

  public getReflectionContext(): IReflectionContext {
    return JSON.parse(JSON.stringify(this.reflectionContext));
  }
}
