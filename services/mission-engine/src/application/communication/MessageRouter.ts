import { AgentMessage, MessageType } from "./AgentMessage";

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

export class MessageRouter {
  private agentHandlers: Map<string, MessageHandler> = new Map();
  private typeHandlers: Map<MessageType, MessageHandler[]> = new Map();

  /**
   * Registers a message handler for a specific agent.
   */
  public registerAgentHandler(agentId: string, handler: MessageHandler): void {
    this.agentHandlers.set(agentId, handler);
  }

  /**
   * Unregisters a message handler for a specific agent.
   */
  public deregisterAgentHandler(agentId: string): void {
    this.agentHandlers.delete(agentId);
  }

  /**
   * Registers a message handler for a specific message type.
   */
  public registerTypeHandler(type: MessageType, handler: MessageHandler): void {
    const handlers = this.typeHandlers.get(type) || [];
    handlers.push(handler);
    this.typeHandlers.set(type, handlers);
  }

  /**
   * Dispatches/Routes a message to its appropriate recipient(s).
   *
   * @param message The message to route
   * @returns array of agent IDs that successfully received the message
   */
  public async route(message: AgentMessage): Promise<string[]> {
    const deliveredAgents: string[] = [];

    // 1. Route to specific target agent
    if (message.toAgentId && message.toAgentId !== "BROADCAST" && message.toAgentId !== "SYSTEM") {
      const handler = this.agentHandlers.get(message.toAgentId);
      if (handler) {
        try {
          await handler(message);
          deliveredAgents.push(message.toAgentId);
        } catch (error) {
          console.error(`Failed to route message ${message.messageId} to agent ${message.toAgentId}:`, error);
        }
      }
    }

    // 2. Broadcast handling
    if (message.toAgentId === "BROADCAST") {
      for (const [agentId, handler] of this.agentHandlers.entries()) {
        if (agentId !== message.fromAgentId) {
          try {
            await handler(message);
            deliveredAgents.push(agentId);
          } catch (error) {
            console.error(`Failed to broadcast message ${message.messageId} to agent ${agentId}:`, error);
          }
        }
      }
    }

    // 3. Route based on Message Type to registered type handlers
    const typeHandlers = this.typeHandlers.get(message.messageType) || [];
    for (const typeHandler of typeHandlers) {
      try {
        await typeHandler(message);
      } catch (error) {
        console.error(`Failed type-based routing for message ${message.messageId}:`, error);
      }
    }

    return deliveredAgents;
  }

  /**
   * Clears all registered handlers.
   */
  public clear(): void {
    this.agentHandlers.clear();
    this.typeHandlers.clear();
  }
}
