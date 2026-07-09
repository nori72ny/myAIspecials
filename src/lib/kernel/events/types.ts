export type EventType =
  | 'GoalSubmitted'
  | 'IntentClarified'
  | 'MissionsProposed'
  | 'MissionCreated'
  | 'PlanningStarted'
  | 'PlanningFinished'
  | 'ExecutionStarted'
  | 'ExecutionFinished'
  | 'ConsensusFinished'
  | 'QualityChecked'
  | 'ResponseGenerated'
  | 'ProviderRegistered'
  | 'ProviderUnregistered'
  | 'ProviderHealthChanged'
  | 'ProviderMetricsUpdated'
  | 'CapabilityRouted';

export interface BaseEventPayload {
  eventId: string;
  missionId?: string; // Optional for Goal Engine events
  timestamp: number;
}

export interface GoalSubmittedPayload extends BaseEventPayload {
  goalId: string;
  rawInput: string;
  userId: string;
}

export interface IntentClarifiedPayload extends BaseEventPayload {
  goalId: string;
  intent: {
    clarifiedObjective: string;
    targetAudience?: string;
    constraints: string[];
  };
}

export interface MissionsProposedPayload extends BaseEventPayload {
  goalId: string;
  proposedMissions: {
    missionId: string;
    title: string;
    description: string;
    order: number;
  }[];
}

export interface MissionCreatedPayload extends BaseEventPayload {
  missionId: string;
  creatorId: string;
  objective: string;
  context: Record<string, any>;
}

export interface PlanningStartedPayload extends BaseEventPayload {
  missionId: string;
  plannerAgentId: string;
}

export interface PlanningFinishedPayload extends BaseEventPayload {
  missionId: string;
  plan: {
    taskId: string;
    description: string;
    dependencies: string[];
  }[];
}

export interface ExecutionStartedPayload extends BaseEventPayload {
  missionId: string;
  taskId: string;
  executorAgentId: string;
}

export interface ExecutionFinishedPayload extends BaseEventPayload {
  missionId: string;
  taskId: string;
  result: any;
  success: boolean;
  error?: string;
}

export interface ConsensusFinishedPayload extends BaseEventPayload {
  missionId: string;
  taskId: string;
  agreedResult: any;
  participatingAgentIds: string[];
}

export interface QualityCheckedPayload extends BaseEventPayload {
  missionId: string;
  taskId: string;
  reviewerAgentId: string;
  passed: boolean;
  score: number;
  feedback: string;
}

export interface ResponseGeneratedPayload extends BaseEventPayload {
  missionId: string;
  response: string;
}

export interface ProviderRegisteredPayload extends BaseEventPayload {
  providerId: string;
  name: string;
  adapterId: string;
  capabilities: string[];
}

export interface ProviderUnregisteredPayload extends BaseEventPayload {
  providerId: string;
}

export interface ProviderHealthChangedPayload extends BaseEventPayload {
  providerId: string;
  oldHealth: string;
  newHealth: string;
}

export interface ProviderMetricsUpdatedPayload extends BaseEventPayload {
  providerId: string;
  metrics: {
    cost: number;
    latency: number;
    quality: number;
    failureRate: number;
  };
}

export interface CapabilityRoutedPayload extends BaseEventPayload {
  requestedCapabilities: string[];
  priority: string;
  selectedProviderId: string;
  score: number;
}

export type EventPayloadMap = {
  GoalSubmitted: GoalSubmittedPayload;
  IntentClarified: IntentClarifiedPayload;
  MissionsProposed: MissionsProposedPayload;
  MissionCreated: MissionCreatedPayload;
  PlanningStarted: PlanningStartedPayload;
  PlanningFinished: PlanningFinishedPayload;
  ExecutionStarted: ExecutionStartedPayload;
  ExecutionFinished: ExecutionFinishedPayload;
  ConsensusFinished: ConsensusFinishedPayload;
  QualityChecked: QualityCheckedPayload;
  ResponseGenerated: ResponseGeneratedPayload;
  ProviderRegistered: ProviderRegisteredPayload;
  ProviderUnregistered: ProviderUnregisteredPayload;
  ProviderHealthChanged: ProviderHealthChangedPayload;
  ProviderMetricsUpdated: ProviderMetricsUpdatedPayload;
  CapabilityRouted: CapabilityRoutedPayload;
};

export type EventHandler<T extends EventType> = (payload: EventPayloadMap[T]) => void | Promise<void>;
