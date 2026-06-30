import { OrgRole, EscalationRecord, Task } from "./OrganizationTypes";

export class EscalationEngine {
  /**
   * Translates current role to the next escalation target role in the hierarchy.
   */
  public getNextEscalationRole(currentRole: OrgRole): OrgRole {
    switch (currentRole) {
      case OrgRole.WORKER:
        return OrgRole.MANAGER;
      case OrgRole.MANAGER:
        return OrgRole.DIRECTOR;
      case OrgRole.DIRECTOR:
        return OrgRole.CHIEF;
      case OrgRole.CHIEF:
        return OrgRole.BOARD;
      case OrgRole.BOARD:
      default:
        return OrgRole.CEO;
    }
  }

  /**
   * Triggers an escalation record for a given blocked task.
   */
  public triggerEscalation(
    orgId: string,
    task: Task,
    fromAgentId: string,
    currentRole: OrgRole,
    reason: string
  ): EscalationRecord {
    const targetRole = this.getNextEscalationRole(currentRole);
    
    return {
      id: `esc-${Math.random().toString(36).substring(2, 9)}`,
      orgId,
      taskId: task.id,
      fromAgentId,
      toRole: targetRole,
      reason,
      timestamp: new Date(),
      resolved: false
    };
  }

  /**
   * Resolves an escalation, applying upper management override instructions.
   */
  public resolveEscalation(
    record: EscalationRecord,
    resolverAgentId: string,
    resolutionNote: string
  ): EscalationRecord {
    return {
      ...record,
      toAgentId: resolverAgentId,
      resolved: true,
      resolutionNote,
      timestamp: new Date() // updated to resolution time
    };
  }
}
