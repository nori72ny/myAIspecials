import { OrgRole, Task } from "./OrganizationTypes";

export class DelegationEngine {
  /**
   * Evaluates if a task should be delegated from a higher role to a lower role.
   * Rules:
   * 1. CEO/BOARD can delegate to CHIEF.
   * 2. CHIEF can delegate to DIRECTOR.
   * 3. DIRECTOR can delegate to MANAGER.
   * 4. MANAGER can delegate to WORKER.
   * 
   * Criteria:
   * - delegator agent is overloaded (load >= 2)
   * - delegator agent doesn't have the specialized capability required for the task (e.g., MANAGER has "Planning" but task needs "Coding").
   */
  public shouldDelegate(
    task: Task, 
    delegatorRole: OrgRole, 
    delegatorLoad: number, 
    delegatorCapabilities: string[]
  ): boolean {
    // 1. Worker cannot delegate
    if (delegatorRole === OrgRole.WORKER) {
      return false;
    }

    // 2. Overload rule
    if (delegatorLoad >= 2) {
      return true;
    }

    // 3. Capability mismatch rule
    const requiredCap = task.requiredCapability;
    const hasRequiredCapability = delegatorCapabilities.includes(requiredCap);
    if (!hasRequiredCapability && requiredCap) {
      return true;
    }

    // If task priority is low, higher-ups should delegate to focus on high-priority strategist work
    if (task.priority < 5 && delegatorRole !== OrgRole.MANAGER) {
      return true;
    }

    return false;
  }

  /**
   * Resolves the target role for delegation based on the delegator's role.
   */
  public getDelegationTargetRole(currentRole: OrgRole): OrgRole {
    switch (currentRole) {
      case OrgRole.CEO:
        return OrgRole.BOARD;
      case OrgRole.BOARD:
        return OrgRole.CHIEF;
      case OrgRole.CHIEF:
        return OrgRole.DIRECTOR;
      case OrgRole.DIRECTOR:
        return OrgRole.MANAGER;
      case OrgRole.MANAGER:
      default:
        return OrgRole.WORKER;
    }
  }

  /**
   * Processes the delegation on a task, setting the delegation trace.
   */
  public delegateTask(task: Task, fromAgentId: string): Task {
    return {
      ...task,
      delegatedFromAgentId: fromAgentId,
      status: "Pending", // Reset status to Pending for new assignment
      updatedAt: new Date()
    };
  }
}
