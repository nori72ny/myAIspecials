import { OrganizationState, ReviewStatus } from "../organization/OrganizationTypes";
import { DynamicOrganizationEngine } from "./DynamicOrganizationEngine";
import { ExecutiveDecisionEngine } from "./ExecutiveDecisionEngine";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { OrganizationalMemoryRepository } from "./OrganizationalMemoryRepository";
import { OrganizationalMemory, ExecutiveDecision } from "./EvolutionTypes";

export class OrganizationEvolutionEngine {
  private dynamicOrg: DynamicOrganizationEngine;
  private execDecision: ExecutiveDecisionEngine;
  private knowledgeGraph: KnowledgeGraph;
  private memoryRepo: OrganizationalMemoryRepository;

  private static instance: OrganizationEvolutionEngine;

  private constructor() {
    this.dynamicOrg = new DynamicOrganizationEngine();
    this.execDecision = new ExecutiveDecisionEngine();
    this.knowledgeGraph = KnowledgeGraph.getInstance();
    this.memoryRepo = OrganizationalMemoryRepository.getInstance();
  }

  public static getInstance(): OrganizationEvolutionEngine {
    if (!OrganizationEvolutionEngine.instance) {
      OrganizationEvolutionEngine.instance = new OrganizationEvolutionEngine();
    }
    return OrganizationEvolutionEngine.instance;
  }

  public evaluateMission(state: OrganizationState): void {
    // 1. Process Results into Memory
    const success = state.reviews.every(r => r.status === ReviewStatus.APPROVED);
    const score = state.reviews.reduce((acc, r) => acc + r.score, 0) / (state.reviews.length || 1);
    
    const memory: OrganizationalMemory = {
      id: `mem-${Date.now()}`,
      missionId: state.missionId,
      success,
      score,
      successStories: success ? ["Mission completed successfully with high consensus."] : [],
      failureStories: !success ? ["Bottlenecks detected in review pipeline."] : [],
      improvements: [],
      kpiSnapshot: {
        activeTasks: state.activeTasks.length,
        deliverables: state.deliverables.length,
        reviews: state.reviews.length,
        consensusRounds: state.consensusRounds.length
      },
      timestamp: new Date()
    };
    
    // 2. Update Knowledge Graph with relationships and interactions
    state.reviews.forEach(review => {
      const deliverable = state.deliverables.find(d => d.id === review.deliverableId);
      if (deliverable && deliverable.authorAgentId && review.reviewerAgentId) {
        this.knowledgeGraph.recordInteraction(
          review.reviewerAgentId,
          deliverable.authorAgentId,
          "REVIEW",
          review.score >= 80
        );
      }
    });

    state.activeTasks.forEach(task => {
      if (task.assignedAgentId) {
        let node = this.knowledgeGraph.getNode(task.assignedAgentId);
        if (!node) {
          node = { agentId: task.assignedAgentId, expertise: [task.requiredCapability], successRate: 100, workload: 0 };
        }
        node.workload += 10;
        this.knowledgeGraph.upsertNode(node);
      }
    });

    // 3. Dynamic Organization Update
    this.dynamicOrg.optimizeStructure(state);
    this.dynamicOrg.updateCapabilities(state);

    // 4. Executive Decision
    const decisions = this.execDecision.evaluatePerformanceAndDecide([...this.memoryRepo.getAll(), memory]);
    decisions.forEach(d => {
      memory.improvements.push(`Executive Action: ${d.type} - ${d.description}`);
    });

    this.memoryRepo.save(memory);
  }

  public getMemoryRepository(): OrganizationalMemoryRepository {
    return this.memoryRepo;
  }

  public getKnowledgeGraph(): KnowledgeGraph {
    return this.knowledgeGraph;
  }
}
