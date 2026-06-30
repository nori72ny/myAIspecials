export type AgentEventType =
  | "AgentCreated"
  | "AgentActivated"
  | "AgentSuspended"
  | "AgentRetired";

export interface AgentGovernanceEvent {
  id: string; // Event ID
  timestamp: Date;
  eventType: AgentEventType;
  agentId: string;
  details: Record<string, any>;
  description: string;
}

export class AgentGovernanceEvents {
  private static instance: AgentGovernanceEvents;
  private events: AgentGovernanceEvent[] = [];

  private constructor() {}

  public static getInstance(): AgentGovernanceEvents {
    if (!AgentGovernanceEvents.instance) {
      AgentGovernanceEvents.instance = new AgentGovernanceEvents();
    }
    return AgentGovernanceEvents.instance;
  }

  public record(eventType: AgentEventType, agentId: string, details: Record<string, any> = {}, description?: string): AgentGovernanceEvent {
    const event: AgentGovernanceEvent = {
      id: `EVT-${Math.random().toString(36).substring(2, 11).toUpperCase()}`,
      timestamp: new Date(),
      eventType,
      agentId,
      details,
      description: description || `Event ${eventType} recorded for Agent ${agentId}.`
    };
    this.events.push(event);
    console.log(`[GOVERNANCE] [${eventType}] Agent: ${agentId} - ${event.description}`);
    return event;
  }

  public getEvents(): AgentGovernanceEvent[] {
    return [...this.events];
  }

  public getEventsByAgent(agentId: string): AgentGovernanceEvent[] {
    return this.events.filter(e => e.agentId === agentId);
  }

  public getEventsByType(type: AgentEventType): AgentGovernanceEvent[] {
    return this.events.filter(e => e.eventType === type);
  }

  public clear(): void {
    this.events = [];
  }
}
