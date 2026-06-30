import { OrganizationState, OrgDepartment, OrgRole } from "../organization/OrganizationTypes";
import { KnowledgeGraph } from "./KnowledgeGraph";

export class DynamicOrganizationEngine {
  private knowledgeGraph: KnowledgeGraph;

  constructor() {
    this.knowledgeGraph = KnowledgeGraph.getInstance();
  }

  public optimizeStructure(state: OrganizationState): void {
    // Basic heuristics to optimize
    const nodes = this.knowledgeGraph.getAllNodes();
    
    // Auto-balance departments based on workload
    // (mock implementation of Dynamic Organization)
    let engineeringLoad = 0;
    let researchLoad = 0;
    
    nodes.forEach(n => {
      if (state.departments[OrgDepartment.Engineering]?.includes(n.agentId)) {
        engineeringLoad += n.workload;
      }
      if (state.departments[OrgDepartment.Research]?.includes(n.agentId)) {
        researchLoad += n.workload;
      }
    });

    if (engineeringLoad > researchLoad * 1.5 && state.departments[OrgDepartment.Research]?.length > 1) {
      // Move one idle researcher to engineering if they have coding expertise
      const availableResearcher = nodes.find(n => 
        state.departments[OrgDepartment.Research]?.includes(n.agentId) && 
        n.expertise.includes("Coding") && 
        n.workload < 50
      );
      
      if (availableResearcher) {
        state.departments[OrgDepartment.Research] = state.departments[OrgDepartment.Research].filter(id => id !== availableResearcher.agentId);
        state.departments[OrgDepartment.Engineering].push(availableResearcher.agentId);
      }
    }
  }

  public updateCapabilities(state: OrganizationState): void {
    if (!state.aiWorkers) return;
    
    // Update capabilities based on graph
    state.aiWorkers.forEach(ai => {
      const node = this.knowledgeGraph.getNode(ai.id);
      if (node) {
        ai.successRate = (ai.successRate + node.successRate) / 2;
      }
    });
  }
}
