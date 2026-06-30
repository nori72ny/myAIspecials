import { AgentRegistryService } from "../agent/governance/AgentRegistryService";
import { AgentLifecycleState, AgentCapability } from "../agent/governance/AgentGovernanceTypes";
import { MessageType } from "./AgentMessage";

export class CommunicationPolicy {
  private registryService: AgentRegistryService;

  constructor(registryService: AgentRegistryService = AgentRegistryService.getInstance()) {
    this.registryService = registryService;
  }

  /**
   * Evaluates if a communication from one agent to another is permitted.
   *
   * @param fromAgentId ID of the sending agent (or "SYSTEM")
   * @param toAgentId ID of the receiving agent (or "SYSTEM" or "BROADCAST")
   * @param messageType The type of message being sent
   * @returns an object indicating if the communication is allowed and the reason if blocked
   */
  public isCommunicationAllowed(fromAgentId: string, toAgentId: string, messageType: MessageType): { allowed: boolean; reason?: string } {
    // 1. System bypass
    if (fromAgentId === "SYSTEM") {
      return { allowed: true };
    }

    // 2. Sender existence check
    const sender = this.registryService.getAgent(fromAgentId);
    if (!sender) {
      return { allowed: false, reason: `Sender agent ${fromAgentId} does not exist.` };
    }

    // 3. Sender state check
    const blockedStates = [
      AgentLifecycleState.Suspended,
      AgentLifecycleState.Disabled,
      AgentLifecycleState.Retired,
      AgentLifecycleState.Draft
    ];

    if (blockedStates.includes(sender.state)) {
      return { allowed: false, reason: `Sender agent ${fromAgentId} is in an inactive state: ${sender.state}.` };
    }

    // 4. Receiver existence and state checks (unless receiver is SYSTEM or BROADCAST)
    if (toAgentId !== "SYSTEM" && toAgentId !== "BROADCAST") {
      const receiver = this.registryService.getAgent(toAgentId);
      if (!receiver) {
        return { allowed: false, reason: `Receiver agent ${toAgentId} does not exist.` };
      }

      if (blockedStates.includes(receiver.state)) {
        return { allowed: false, reason: `Receiver agent ${toAgentId} is in an inactive state: ${receiver.state}.` };
      }
    }

    // 5. Capability-based access control rules
    if (messageType === MessageType.REQUEST) {
      const hasRequestCapability = sender.capabilities.includes(AgentCapability.Planning) ||
                                   sender.capabilities.includes(AgentCapability.ToolUse) ||
                                   sender.capabilities.includes(AgentCapability.Writing) ||
                                   sender.capabilities.includes(AgentCapability.Coding);
      if (!hasRequestCapability) {
        return { allowed: false, reason: `Sender agent ${fromAgentId} lacks required capabilities to send a REQUEST.` };
      }
    }

    if (messageType === MessageType.REVIEW || messageType === MessageType.APPROVAL || messageType === MessageType.REJECTION) {
      const hasReviewCapability = sender.capabilities.includes(AgentCapability.Planning) ||
                                  sender.capabilities.includes(AgentCapability.Research) ||
                                  sender.capabilities.includes(AgentCapability.Writing) ||
                                  sender.capabilities.includes(AgentCapability.Coding);
      if (!hasReviewCapability) {
        return { allowed: false, reason: `Sender agent ${fromAgentId} lacks required capabilities to send a ${messageType}.` };
      }
    }

    return { allowed: true };
  }
}
