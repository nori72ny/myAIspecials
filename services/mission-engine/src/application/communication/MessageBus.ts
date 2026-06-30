import { randomUUID } from "crypto";
import { AgentMessage, MessageStatus, MessageType } from "./AgentMessage";
import { MessagePriority } from "./MessagePriority";
import { ConversationThread } from "./ConversationThread";
import { ConversationHistory } from "./ConversationHistory";
import { MessageValidator } from "./MessageValidator";
import { MessageRouter } from "./MessageRouter";

export class MessageBus {
  private static instance: MessageBus | null = null;

  private threads: Map<string, ConversationThread> = new Map();
  private history: ConversationHistory;
  private validator: MessageValidator;
  private router: MessageRouter;
  private messageStore: Map<string, AgentMessage> = new Map();

  constructor(
    history: ConversationHistory = new ConversationHistory(),
    validator: MessageValidator = new MessageValidator(),
    router: MessageRouter = new MessageRouter()
  ) {
    this.history = history;
    this.validator = validator;
    this.router = router;
  }

  public static getInstance(): MessageBus {
    if (!this.instance) {
      this.instance = new MessageBus();
    }
    return this.instance;
  }

  public static resetInstance(): void {
    this.instance = null;
  }

  /**
   * Retrieves or creates a conversation thread.
   */
  public getOrCreateThread(threadId: string, missionId: string, initialParticipants: string[] = []): ConversationThread {
    let thread = this.threads.get(threadId);
    if (!thread) {
      thread = new ConversationThread(threadId, missionId, initialParticipants);
      this.threads.set(threadId, thread);
    }
    return thread;
  }

  /**
   * Gets a specific conversation thread by ID.
   */
  public getThread(threadId: string): ConversationThread | null {
    return this.threads.get(threadId) || null;
  }

  /**
   * Gets all threads belonging to a specific mission.
   */
  public getThreadsByMission(missionId: string): ConversationThread[] {
    return Array.from(this.threads.values()).filter(t => t.missionId === missionId);
  }

  /**
   * Sends an inter-agent message.
   * Performs validation, status progression, thread appending, history archival, and routing.
   *
   * @param payload The message content and target details
   * @returns The fully processed AgentMessage
   */
  public async sendMessage(payload: {
    threadId: string;
    missionId: string;
    fromAgentId: string;
    toAgentId: string;
    messageType: MessageType;
    priority?: MessagePriority;
    content: string;
    metadata?: Record<string, any>;
  }): Promise<AgentMessage> {
    const messageId = randomUUID();
    const createdAt = new Date();
    const priority = payload.priority || MessagePriority.NORMAL;
    const metadata = payload.metadata || {};

    const messageDraft: AgentMessage = {
      messageId,
      threadId: payload.threadId,
      missionId: payload.missionId,
      fromAgentId: payload.fromAgentId,
      toAgentId: payload.toAgentId,
      messageType: payload.messageType,
      priority,
      content: payload.content,
      createdAt,
      status: MessageStatus.Created,
      metadata
    };

    // 1. Validate the message
    const validationResult = this.validator.validate(messageDraft);

    if (!validationResult.valid) {
      messageDraft.status = MessageStatus.Rejected;
      messageDraft.metadata.rejectionReason = validationResult.error || "Unknown validation error";
      this.history.addMessage(messageDraft);
      this.messageStore.set(messageId, messageDraft);
      throw new Error(`Message rejected: ${validationResult.error}`);
    }

    // Apply sanitization if required by the firewall
    if (validationResult.sanitizedContent) {
      messageDraft.content = validationResult.sanitizedContent;
    }

    // 2. Advance status to Sent
    messageDraft.status = MessageStatus.Sent;

    // 3. Append to Thread
    const thread = this.getOrCreateThread(payload.threadId, payload.missionId, [payload.fromAgentId, payload.toAgentId]);
    thread.addMessage(messageDraft);

    // 4. Record to History and store
    this.history.addMessage(messageDraft);
    this.messageStore.set(messageId, messageDraft);

    // 5. Route to recipients
    const deliveredRecipients = await this.router.route(messageDraft);

    // 6. Update status based on delivery
    if (deliveredRecipients.length > 0) {
      this.updateMessageStatus(messageId, MessageStatus.Delivered);
    }

    return this.messageStore.get(messageId)!;
  }

  /**
   * Updates the status of a specific message and propagates changes to thread and history.
   */
  public updateMessageStatus(messageId: string, status: MessageStatus): boolean {
    const message = this.messageStore.get(messageId);
    if (!message) return false;

    message.status = status;

    // Also update in thread
    const thread = this.threads.get(message.threadId);
    if (thread) {
      thread.updateMessageStatus(messageId, status);
    }

    // Also update in history
    this.history.updateMessageStatus(messageId, status);

    return true;
  }

  /**
   * Marks a specific message as Read.
   */
  public markAsRead(messageId: string): boolean {
    return this.updateMessageStatus(messageId, MessageStatus.Read);
  }

  /**
   * Retrieves the validation service.
   */
  public getValidator(): MessageValidator {
    return this.validator;
  }

  /**
   * Retrieves the routing service.
   */
  public getRouter(): MessageRouter {
    return this.router;
  }

  /**
   * Retrieves the queryable history repository.
   */
  public getHistory(): ConversationHistory {
    return this.history;
  }

  /**
   * Completely clears the message bus state for clean testing.
   */
  public clear(): void {
    this.threads.clear();
    this.messageStore.clear();
    this.history.clear();
    this.router.clear();
  }
}
