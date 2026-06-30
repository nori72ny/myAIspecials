import { Agent, AgentId, createAgentId, IAgentRepository } from "@origin/domain";

/**
 * InMemoryAgentRepository
 * Simulates SQL storage of Agent descriptors ready for Prisma.
 */
export class InMemoryAgentRepository implements IAgentRepository {
  private agentsDb: Map<string, {
    id: string;
    role: string;
    capabilities: string[];
    status: string;
  }> = new Map([
    ["agent-1", { id: "agent-1", role: "ARCHITECT", capabilities: ["DESIGN", "PLAN", "ASSIST"], status: "Available" }],
    ["agent-2", { id: "agent-2", role: "RESEARCHER", capabilities: ["SEARCH", "ANALYZE", "ASSIST"], status: "Available" }],
    ["agent-default", { id: "agent-default", role: "GENERAL", capabilities: ["ASSIST"], status: "Available" }]
  ]);

  async findById(id: AgentId): Promise<Agent | null> {
    const row = this.agentsDb.get(id);
    if (!row) return null;

    // Rehydrate domain entity
    const agent = new Agent(createAgentId(row.id), row.role, row.capabilities);
    if (row.status === "Assigned") {
      agent.assign();
    } else if (row.status === "Working") {
      agent.assign();
      agent.startWorking();
    } else if (row.status === "Unavailable") {
      agent.markUnavailable();
    }
    return agent;
  }

  async findByCapability(capability: string): Promise<Agent[]> {
    const matched: Agent[] = [];
    for (const row of this.agentsDb.values()) {
      if (row.capabilities.includes(capability)) {
        const agent = await this.findById(createAgentId(row.id));
        if (agent) matched.push(agent);
      }
    }
    return matched;
  }

  async save(agent: Agent): Promise<void> {
    // === START TRANSACTION ===
    this.agentsDb.set(agent.id, {
      id: agent.id,
      role: agent.role,
      capabilities: agent.capabilities,
      status: agent.status
    });
    // === COMMIT TRANSACTION ===
  }
}

