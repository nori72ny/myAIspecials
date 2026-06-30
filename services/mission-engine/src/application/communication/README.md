# Agent Communication Layer (ORIGIN Core)

The **Agent Communication Layer** is a secure, structured, and resilient message-bus system designed for inter-agent communication, review coordination, consensus-building, and system broadcasts within the **ORIGIN Core** architecture. 

It leverages the existing Version 1.x Security Policy Engine, Prompt Injection Firewalls, and Agent Governance Registries to guarantee complete, zero-trust communication isolation.

---

## 1. Architectural Diagrams

### 1.1 Agent Communication Sequence

This sequence diagram illustrates how a sending agent communicates with a target receiving agent securely via the centralized `MessageBus`.

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent A (Sender)
    participant MB as MessageBus
    participant MV as MessageValidator
    participant CP as CommunicationPolicy
    participant MR as MessageRouter
    participant B as Agent B (Recipient)
    participant CH as ConversationHistory

    A->>MB: sendMessage(payload)
    activate MB
    MB->>MV: validate(messageDraft)
    activate MV
    MV->>CP: isCommunicationAllowed(from, to, type)
    activate CP
    CP-->>MV: { allowed: true }
    deactivate CP
    
    Note over MV: 1. Presence check<br/>2. Text length check<br/>3. Prompt Injection scan<br/>4. Unsafe Command validation (rm -rf, etc.)
    
    MV-->>MB: { valid: true, sanitizedContent? }
    deactivate MV

    Note over MB: Append message to ConversationThread<br/>Archive to ConversationHistory (Status: Sent)

    MB->>MR: route(message)
    activate MR
    MR->>B: Trigger Agent Handler Callback
    activate B
    B-->>MR: Acknowledge delivery
    deactivate B
    MR-->>MB: [agentBId] (Delivered Recipients)
    deactivate MR

    Note over MB: Update message status to "Delivered"<br/>Synchronize thread & history states
    MB-->>A: Return processed AgentMessage
    deactivate MB
```

---

### 1.2 Message Flow

The state progression of an `AgentMessage` as it moves from creation to archival and final completion.

```mermaid
graph TD
    classDef state fill:#f9f,stroke:#333,stroke-width:2px;
    classDef process fill:#bbf,stroke:#333,stroke-width:1px;
    
    Start((Message Payload)) --> Draft[1. Create AgentMessage Draft]
    Draft --> Val{2. Validate & Scan}
    
    Val -- Security Violation or<br/>Policy Block --> StatusRejected(Rejected)
    Val -- Safe / Sanitized --> StatusSent(Sent)
    
    StatusSent --> ThreadAppend[3. Append to Thread]
    ThreadAppend --> HistoryLog[4. Archive to History]
    HistoryLog --> Route[5. Route to Recipients]
    
    Route -- Delivery Success --> StatusDelivered(Delivered)
    Route -- Delivery Failed / No Handlers --> RemainSent[Remain Sent]
    
    StatusDelivered --> StatusRead(Read)
    StatusRead --> StatusProcessing(Processing)
    StatusProcessing --> StatusCompleted(Completed)
    
    class StatusRejected,StatusSent,StatusDelivered,StatusRead,StatusProcessing,StatusCompleted state;
    class Draft,Val,ThreadAppend,HistoryLog,Route process;
```

---

### 1.3 Conversation Thread Structure

Threads organize conversations dynamically based on **Mission ID**, allowing multi-stage collaborations, requests, and reviews.

```mermaid
classDiagram
    class Mission {
        +string missionId
    }
    
    class ConversationThread {
        +string threadId
        +string missionId
        -Set participants
        -AgentMessage[] messages
        +Date createdAt
        +Date updatedAt
        +Record metadata
        +addMessage(message)
        +updateMessageStatus(id, status)
        +getMessages()
        +getParticipants()
    }
    
    class AgentMessage {
        +string messageId
        +string threadId
        +string missionId
        +string fromAgentId
        +string toAgentId
        +MessageType messageType
        +MessagePriority priority
        +string content
        +Date createdAt
        +MessageStatus status
        +Record metadata
    }
    
    Mission "1" --o "*" ConversationThread : owns
    ConversationThread "1" --* "*" AgentMessage : encapsulates
```

---

## 2. Core Modules

| Module Name | File Path | Responsibilities |
| :--- | :--- | :--- |
| **AgentMessage** | `AgentMessage.ts` | Defines the standard data model, `MessageType` (REQUEST, RESPONSE, QUESTION, ANSWER, REVIEW, APPROVAL, REJECTION, SYSTEM), and `MessageStatus` state-tracking enums. |
| **MessagePriority** | `MessagePriority.ts` | Defines the priorities (`LOW`, `NORMAL`, `HIGH`, `URGENT`) of messages inside the system. |
| **ConversationThread** | `ConversationThread.ts` | Tracks a ordered group of inter-agent messages for a specific Mission ID, managing the list of active participants. |
| **ConversationHistory** | `ConversationHistory.ts` | Central log repository enabling structured search, text filtering, and retrieval of messages by Agent, Mission, or Thread. |
| **CommunicationPolicy** | `CommunicationPolicy.ts` | Checks sender/receiver registration and lifecycle states, enforcing capability-based access control (RBAC). |
| **MessageValidator** | `MessageValidator.ts` | Verifies field presence, enforces maximum lengths, and filters against injection attempts (using `PromptInjectionFirewall` and `SafetyPolicyEngine`). |
| **MessageRouter** | `MessageRouter.ts` | Dispatches messages to target agent callback handlers, supports wildcards/type subscriptions, and coordinates broadcasts. |
| **MessageBus** | `MessageBus.ts` | Orchestrates the entire lifecycle: singleton manager coordinating validation, thread appending, archival, routing, and status transitions. |

---

## 3. How to Use

### 3.1 Basic Singleton Initialization
```typescript
import { MessageBus, MessageType, MessagePriority } from "./application/communication";

const messageBus = MessageBus.getInstance();
```

### 3.2 Registering an Agent Handler Callback
To receive routed messages, agents register their handlers on the router:
```typescript
messageBus.getRouter().registerAgentHandler("AGT-CODER", async (msg) => {
  console.log(`Received message from ${msg.fromAgentId}: ${msg.content}`);
});
```

### 3.3 Sending a Secure Message
```typescript
const message = await messageBus.sendMessage({
  threadId: "co-op-thread-101",
  missionId: "ms-react-builder",
  fromAgentId: "AGT-PLANNER",
  toAgentId: "AGT-CODER",
  messageType: MessageType.REQUEST,
  priority: MessagePriority.HIGH,
  content: "Please build the core navigation bar component."
});

console.log(`Message successfully sent with status: ${message.status}`); // "Delivered"
```
