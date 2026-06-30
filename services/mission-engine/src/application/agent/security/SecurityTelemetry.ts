export type SecurityEventType =
  | "PromptInjectionDetected"
  | "ToolSanitized"
  | "ContextRejected"
  | "MemoryRejected"
  | "UnsafeActionBlocked";

export interface SecurityEvent {
  timestamp: Date;
  eventType: SecurityEventType;
  source: string;
  details: Record<string, any>;
  description: string;
}

export class SecurityTelemetry {
  private static instance: SecurityTelemetry;
  private events: SecurityEvent[] = [];

  private constructor() {}

  public static getInstance(): SecurityTelemetry {
    if (!SecurityTelemetry.instance) {
      SecurityTelemetry.instance = new SecurityTelemetry();
    }
    return SecurityTelemetry.instance;
  }

  public record(event: Omit<SecurityEvent, "timestamp">): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: new Date()
    };
    this.events.push(fullEvent);
    console.warn(`[SECURITY] [${fullEvent.eventType}] [${fullEvent.source}]: ${fullEvent.description}`);
  }

  public getEvents(): SecurityEvent[] {
    return [...this.events];
  }

  public getEventsByType(type: SecurityEventType): SecurityEvent[] {
    return this.events.filter(e => e.eventType === type);
  }

  public clear(): void {
    this.events = [];
  }
}
