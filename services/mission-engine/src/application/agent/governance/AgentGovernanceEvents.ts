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

const EVENT_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function createEventId(): string {
  // Generate each character independently so the identifier always has the
  // documented nine-character suffix (base-36 fractional strings can be short).
  let suffix = "";
  for (let index = 0; index < 9; index += 1) {
    suffix += EVENT_ID_ALPHABET[Math.floor(Math.random() * EVENT_ID_ALPHABET.length)];
  }
  return `EVT-${suffix}`;
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
      id: createEventId(),
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
