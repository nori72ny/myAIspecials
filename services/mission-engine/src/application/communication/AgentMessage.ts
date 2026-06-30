import { MessagePriority } from "./MessagePriority";

export enum MessageType {
  REQUEST = "REQUEST",
  RESPONSE = "RESPONSE",
  QUESTION = "QUESTION",
  ANSWER = "ANSWER",
  REVIEW = "REVIEW",
  APPROVAL = "APPROVAL",
  REJECTION = "REJECTION",
  SYSTEM = "SYSTEM"
}

export enum MessageStatus {
  Created = "Created",
  Sent = "Sent",
  Delivered = "Delivered",
  Read = "Read",
  Processing = "Processing",
  Completed = "Completed",
  Rejected = "Rejected",
  Expired = "Expired"
}

export interface AgentMessage {
  messageId: string;
  threadId: string;
  missionId: string;
  fromAgentId: string;
  toAgentId: string;
  messageType: MessageType;
  priority: MessagePriority;
  content: string;
  createdAt: Date;
  status: MessageStatus;
  metadata: Record<string, any>;
}
