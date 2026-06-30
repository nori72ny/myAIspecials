import { AgentMessage } from "./AgentMessage";

export interface MessageSearchQuery {
  missionId?: string;
  threadId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  messageType?: string;
  priority?: string;
  status?: string;
  contentLike?: string;
  startDate?: Date;
  endDate?: Date;
}

export class ConversationHistory {
  private messages: AgentMessage[] = [];

  /**
   * Records a message in the communication history.
   * @param message Message to add
   */
  public addMessage(message: AgentMessage): void {
    this.messages.push({ ...message });
  }

  /**
   * Retrieves messages by specific Agent (either sender or receiver).
   * @param agentId Agent ID
   */
  public getMessagesByAgent(agentId: string): AgentMessage[] {
    return this.messages
      .filter(m => m.fromAgentId === agentId || m.toAgentId === agentId)
      .map(m => ({ ...m }));
  }

  /**
   * Retrieves messages by Mission ID.
   * @param missionId Mission ID
   */
  public getMessagesByMission(missionId: string): AgentMessage[] {
    return this.messages
      .filter(m => m.missionId === missionId)
      .map(m => ({ ...m }));
  }

  /**
   * Retrieves messages by Thread ID.
   * @param threadId Thread ID
   */
  public getMessagesByThread(threadId: string): AgentMessage[] {
    return this.messages
      .filter(m => m.threadId === threadId)
      .map(m => ({ ...m }));
  }

  /**
   * Searches historical messages using a structured query.
   * @param query Structured query criteria
   */
  public search(query: MessageSearchQuery): AgentMessage[] {
    return this.messages
      .filter(m => {
        if (query.missionId && m.missionId !== query.missionId) return false;
        if (query.threadId && m.threadId !== query.threadId) return false;
        if (query.fromAgentId && m.fromAgentId !== query.fromAgentId) return false;
        if (query.toAgentId && m.toAgentId !== query.toAgentId) return false;
        if (query.messageType && m.messageType !== query.messageType) return false;
        if (query.priority && m.priority !== query.priority) return false;
        if (query.status && m.status !== query.status) return false;
        if (query.contentLike && !m.content.toLowerCase().includes(query.contentLike.toLowerCase())) return false;
        if (query.startDate && m.createdAt < query.startDate) return false;
        if (query.endDate && m.createdAt > query.endDate) return false;
        return true;
      })
      .map(m => ({ ...m }));
  }

  /**
   * Retrieves all messages stored in history.
   */
  public getAllMessages(): AgentMessage[] {
    return this.messages.map(m => ({ ...m }));
  }

  /**
   * Updates the status of an archived message.
   */
  public updateMessageStatus(messageId: string, status: any): boolean {
    const msg = this.messages.find(m => m.messageId === messageId);
    if (msg) {
      msg.status = status;
      return true;
    }
    return false;
  }

  /**
   * Clears all stored message history.
   */
  public clear(): void {
    this.messages = [];
  }
}
