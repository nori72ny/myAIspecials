import { AgentId } from "../types/BrandedTypes";
import { Agent } from "../agent/Agent";

export interface IAgentRepository {
  findById(id: AgentId): Promise<Agent | null>;
  findByCapability(capability: string): Promise<Agent[]>;
  save(agent: Agent): Promise<void>;
}
