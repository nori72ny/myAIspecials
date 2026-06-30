import { AgentRegistryService } from "../agent/governance/AgentRegistryService";
import { AgentGovernanceRecord, AgentLifecycleState, AgentCapability } from "../agent/governance/AgentGovernanceTypes";
import { Task, OrgDepartment } from "./OrganizationTypes";

export class WorkDistributionEngine {
  private registryService: AgentRegistryService;

  constructor(registryService?: AgentRegistryService) {
    this.registryService = registryService || AgentRegistryService.getInstance();
  }

  /**
   * Distributes a task to the most suitable agent based on capability, availability, load, and priority.
   */
  public findOptimalAgent(task: Task, departmentAgents: string[]): AgentGovernanceRecord | undefined {
    const allAgents = this.registryService.listAgents();
    
    // Filter to only those agents in the specific department partition
    const candidates = allAgents.filter(agent => 
      departmentAgents.includes(agent.id) &&
      agent.state === AgentLifecycleState.Active
    );

    if (candidates.length === 0) {
      return undefined;
    }

    // Map the string requiredCapability to the AgentCapability enum
    const reqCap = task.requiredCapability as AgentCapability;

    // Calculate suitability scores
    const scoredCandidates = candidates.map(agent => {
      let score = 0;

      // 1. Capability Match (Critical)
      if (reqCap) {
        const hasCapability = agent.capabilities.includes(reqCap);
        if (!hasCapability) {
          score = -9999; // Disqualify
        } else {
          score += 100;
        }
      }

      // 2. Load Penalty (More load = lower suitability)
      // Standard load is typically 0 to 5.
      const loadPenalty = agent.load * 15;
      score -= loadPenalty;

      // 3. Performance/Health Bonus
      if (agent.health) {
        score += agent.health.successRate * 50;
        // penalty for high error rate
        score -= agent.health.errorRate * 40;
        
        // dynamic performance based on historical runtime
        if (agent.health.averageRuntime > 0) {
          const speedBonus = Math.max(0, 20 - (agent.health.averageRuntime / 1000));
          score += speedBonus;
        }
      }

      // 4. Priority Alignment
      // A high-priority agent (e.g. priority 8-10) is suited for high-priority tasks.
      const priorityDiff = Math.abs(agent.priority - task.priority);
      score += (10 - priorityDiff) * 2;

      return { agent, score };
    });

    // Sort by score descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    const bestCandidate = scoredCandidates[0];
    if (bestCandidate && bestCandidate.score > 0) {
      // Reserve/assign load to the agent in the registry
      const targetAgent = bestCandidate.agent;
      const updatedAgent = this.registryService.updateAgent(targetAgent.id, {
        load: targetAgent.load + 1
      });
      return updatedAgent;
    }

    return undefined;
  }

  /**
   * Releases an agent's load after completing a task.
   */
  public releaseAgent(agentId: string): void {
    try {
      const agent = this.registryService.getAgent(agentId);
      if (agent) {
        this.registryService.updateAgent(agentId, {
          load: Math.max(0, agent.load - 1)
        });
      }
    } catch {
      // Ignored if agent doesn't exist anymore
    }
  }
}
