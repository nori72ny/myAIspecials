import { AgentMessage } from "./AgentMessage";

export class ConversationThread {
  public readonly threadId: string;
  public readonly missionId: string;
  private participants: Set<string> = new Set();
  private messages: AgentMessage[] = [];
  public readonly createdAt: Date;
  public updatedAt: Date;
  public metadata: Record<string, any>;

  constructor(threadId: string, missionId: string, initialParticipants: string[] = [], metadata: Record<string, any> = {}) {
    this.threadId = threadId;
    this.missionId = missionId;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.metadata = metadata;

    for (const participant of initialParticipants) {
      if (participant) {
        this.participants.add(participant);
      }
    }
  }

  public addMessage(message: AgentMessage): void {
    if (message.threadId !== this.threadId) {
      throw new Error(`Message threadId ${message.threadId} does not match thread ${this.threadId}`);
    }
    this.messages.push({ ...message });
    this.participants.add(message.fromAgentId);
    if (message.toAgentId && message.toAgentId !== "BROADCAST") {
      this.participants.add(message.toAgentId);
    }
    this.updatedAt = new Date();
  }

  public getMessages(): AgentMessage[] {
    return this.messages.map(m => ({ ...m }));
  }

  public getParticipants(): string[] {
    return Array.from(this.participants);
  }

  public isParticipant(agentId: string): boolean {
    return this.participants.has(agentId);
  }

  public updateMessageStatus(messageId: string, status: any): boolean {
    const msg = this.messages.find(m => m.messageId === messageId);
    if (msg) {
      msg.status = status;
      this.updatedAt = new Date();
      return true;
    }
    return false;
  }

  public getMessageCount(): number {
    return this.messages.length;
  }
}
