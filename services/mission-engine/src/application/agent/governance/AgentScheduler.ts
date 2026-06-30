import { AgentCapability, AgentGovernanceRecord, AgentLifecycleState } from "./AgentGovernanceTypes";
import { AgentRegistryService } from "./AgentRegistryService";

export interface SchedulerOptions {
  requiredCapabilities: AgentCapability[];
  minPriority?: number;
}

export class AgentScheduler {
  private registryService: AgentRegistryService;

  constructor(registryService: AgentRegistryService = AgentRegistryService.getInstance()) {
    this.registryService = registryService;
  }

  /**
   * Automatically selects the optimal agent based on Capability, Load, Priority, and Health.
   *
   * @param options Criteria for selecting the agent
   * @returns The selected optimal agent governance record, or null if no active agent matches
   */
  public selectAgent(options: SchedulerOptions): AgentGovernanceRecord | null {
    const allAgents = this.registryService.listAgents();

    // 1. Filter: Only consider operational states (Active, Registered, Busy)
    // Avoid Draft, Suspended, Disabled, Retired
    const eligibleAgents = allAgents.filter(agent => 
      agent.state === AgentLifecycleState.Active || 
      agent.state === AgentLifecycleState.Busy || 
      agent.state === AgentLifecycleState.Registered
    );

    if (eligibleAgents.length === 0) {
      return null;
    }

    // 2. Filter: Capability Match
    // Must possess all requested capabilities. If no requiredCapabilities are specified, any agent matches.
    const candidates = eligibleAgents.filter(agent => {
      if (!options.requiredCapabilities || options.requiredCapabilities.length === 0) {
        return true;
      }
      return options.requiredCapabilities.every(reqCap => agent.capabilities.includes(reqCap));
    });

    if (candidates.length === 0) {
      return null;
    }

    // 3. Filter: Minimum Priority (if provided)
    let finalCandidates = candidates;
    if (options.minPriority !== undefined) {
      finalCandidates = candidates.filter(agent => agent.priority >= (options.minPriority || 0));
    }

    if (finalCandidates.length === 0) {
      // Fallback: If no candidate meets the priority threshold, use all capability-matched candidates
      finalCandidates = candidates;
    }

    // 4. Scoring: Calculate score for each candidate and select the highest one
    let bestCandidate: AgentGovernanceRecord | null = null;
    let highestScore = -Infinity;

    for (const candidate of finalCandidates) {
      const score = this.calculateAgentScore(candidate);
      if (score > highestScore) {
        highestScore = score;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }

  /**
   * Calculates a multi-dimensional score for an agent based on:
   * - Priority: Higher priority gets higher score (+10 per priority level)
   * - Load: Penalizes the agent's load to prevent bottlenecks (-25 per parallel job)
   * - Health Success Rate: Higher success rate raises score (+50 * successRate)
   * - Health Error Rate: Higher error rate reduces score (-50 * errorRate)
   * - Health Average Runtime: Faster execution reduces score penalty (-1 point per 1000ms)
   * - Busy state penalty: If state is Busy, subtract 30 points
   */
  private calculateAgentScore(agent: AgentGovernanceRecord): number {
    let score = 0;

    // A. Priority (Weight: 10)
    score += agent.priority * 10;

    // B. Load (Weight: -25)
    score -= agent.load * 25;

    // C. Health Success & Error Rate (Weight: 50)
    score += agent.health.successRate * 50;
    score -= agent.health.errorRate * 50;

    // D. Health Average Runtime (Weight: -1 per 1000ms)
    // Convert ms to seconds to keep penalty proportioned
    const runtimeInSec = agent.health.averageRuntime / 1000;
    score -= runtimeInSec;

    // E. State Penalty
    if (agent.state === AgentLifecycleState.Busy) {
      score -= 30;
    }

    return Number(score.toFixed(4));
  }
}
