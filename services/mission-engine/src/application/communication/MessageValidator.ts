import { AgentMessage } from "./AgentMessage";
import { AgentRegistryService } from "../agent/governance/AgentRegistryService";
import { CommunicationPolicy } from "./CommunicationPolicy";
import { PromptInjectionFirewall } from "../agent/security/PromptInjectionFirewall";
import { SafetyPolicyEngine } from "../agent/security/SafetyPolicyEngine";

export class MessageValidator {
  private registryService: AgentRegistryService;
  private communicationPolicy: CommunicationPolicy;
  private maxContentLength: number;

  constructor(
    registryService: AgentRegistryService = AgentRegistryService.getInstance(),
    communicationPolicy: CommunicationPolicy = new CommunicationPolicy(registryService),
    maxContentLength: number = 50000
  ) {
    this.registryService = registryService;
    this.communicationPolicy = communicationPolicy;
    this.maxContentLength = maxContentLength;
  }

  /**
   * Validates an AgentMessage against all system and security rules.
   *
   * @param message The message properties to validate
   * @returns an object indicating validity, error details, or sanitized content
   */
  public validate(message: Partial<AgentMessage>): { valid: boolean; error?: string; sanitizedContent?: string } {
    const { fromAgentId, toAgentId, messageType, content } = message;

    // 1. Mandatory fields checks
    if (!fromAgentId) {
      return { valid: false, error: "Missing sender agent ID (fromAgentId)." };
    }
    if (!toAgentId) {
      return { valid: false, error: "Missing receiver agent ID (toAgentId)." };
    }
    if (!messageType) {
      return { valid: false, error: "Missing message type (messageType)." };
    }
    if (content === undefined || content === null) {
      return { valid: false, error: "Missing message content." };
    }

    // 2. Presence Checks
    if (fromAgentId !== "SYSTEM") {
      const sender = this.registryService.getAgent(fromAgentId);
      if (!sender) {
        return { valid: false, error: `Sender agent ${fromAgentId} does not exist in registry.` };
      }
    }

    if (toAgentId !== "SYSTEM" && toAgentId !== "BROADCAST") {
      const receiver = this.registryService.getAgent(toAgentId);
      if (!receiver) {
        return { valid: false, error: `Receiver agent ${toAgentId} does not exist in registry.` };
      }
    }

    // 3. Communication Policy Check (Status & Capability Permissions)
    const policyResult = this.communicationPolicy.isCommunicationAllowed(fromAgentId, toAgentId, messageType);
    if (!policyResult.allowed) {
      return { valid: false, error: `Communication blocked by policy: ${policyResult.reason}` };
    }

    // 4. Content Length Check
    if (content.trim().length === 0) {
      return { valid: false, error: "Message content cannot be empty or whitespace only." };
    }
    if (content.length > this.maxContentLength) {
      return { valid: false, error: `Message content exceeds maximum allowed length of ${this.maxContentLength} characters.` };
    }

    // 5. Prompt Injection Firewall Check (Prohibited Strings/Jailbreaks)
    const firewallResult = PromptInjectionFirewall.analyze(content, `AgentCommunication:${fromAgentId}`);
    if (firewallResult.action === "REJECT") {
      return { valid: false, error: `Security violation (Prompt Injection): ${firewallResult.reason}` };
    }

    let activeContent = content;
    if (firewallResult.action === "SANITIZE" && firewallResult.sanitizedContent) {
      activeContent = firewallResult.sanitizedContent;
    }

    // 6. Safety Policy Engine Check (Dangerous commands/Payload signatures)
    const safetyResult = SafetyPolicyEngine.evaluate({
      outputPayload: activeContent,
      missionId: message.missionId
    });

    if (safetyResult === "BLOCK" || safetyResult === "REVIEW") {
      return { valid: false, error: "Security violation (Unsafe commands/payload blocked)." };
    }

    return {
      valid: true,
      sanitizedContent: activeContent !== content ? activeContent : undefined
    };
  }
}
