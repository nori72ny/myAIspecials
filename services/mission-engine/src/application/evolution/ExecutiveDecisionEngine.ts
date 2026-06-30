import { ExecutiveDecision, OrganizationalMemory } from "./EvolutionTypes";

export class ExecutiveDecisionEngine {
  public evaluatePerformanceAndDecide(memories: OrganizationalMemory[]): ExecutiveDecision[] {
    const decisions: ExecutiveDecision[] = [];
    if (memories.length === 0) return decisions;

    const recentMemory = memories[memories.length - 1];
    
    if (recentMemory.success) {
      if (recentMemory.score > 90) {
        decisions.push({
          id: `dec-${Date.now()}`,
          type: "CAPABILITY_UPDATE",
          description: "Exceptional performance detected. Expanding tooling for top-performing departments.",
          approvedBy: "BOARD",
          executedAt: new Date()
        });
      }
    } else {
      decisions.push({
        id: `dec-${Date.now()}`,
        type: "REORGANIZE",
        description: "Mission failure detected. Rebalancing workloads and reassigning managers.",
        approvedBy: "CEO",
        executedAt: new Date()
      });
    }

    return decisions;
  }
}
