import { AgentRelation, AgentNode, IntelligenceDNA } from "./EvolutionTypes";

export class KnowledgeGraph {
  private nodes: Map<string, AgentNode> = new Map();
  private edges: AgentRelation[] = [];
  private dnas: Map<string, IntelligenceDNA> = new Map();

  private static instance: KnowledgeGraph;

  private constructor() {}

  public static getInstance(): KnowledgeGraph {
    if (!KnowledgeGraph.instance) {
      KnowledgeGraph.instance = new KnowledgeGraph();
    }
    return KnowledgeGraph.instance;
  }

  public upsertNode(node: AgentNode) {
    this.nodes.set(node.agentId, node);
  }

  public getNode(agentId: string): AgentNode | undefined {
    return this.nodes.get(agentId);
  }

  public getAllNodes(): AgentNode[] {
    return Array.from(this.nodes.values());
  }

  public getAllRelations(): AgentRelation[] {
    return this.edges;
  }

  public saveDNA(dna: IntelligenceDNA) {
    this.dnas.set(dna.missionId, dna);
  }

  public getAllDNAs(): IntelligenceDNA[] {
    return Array.from(this.dnas.values());
  }

  public getDNAByMissionId(missionId: string): IntelligenceDNA | undefined {
    return this.dnas.get(missionId);
  }

  public recordInteraction(sourceId: string, targetId: string, type: "COLLABORATION" | "REVIEW" | "DELEGATION", success: boolean) {
    let edge = this.edges.find(e => e.sourceAgentId === sourceId && e.targetAgentId === targetId && e.relationType === type);
    if (!edge) {
      edge = {
        sourceAgentId: sourceId,
        targetAgentId: targetId,
        relationType: type,
        trustScore: 50,
        successCount: 0,
        totalCount: 0
      };
      this.edges.push(edge);
    }
    
    edge.totalCount += 1;
    if (success) {
      edge.successCount += 1;
      edge.trustScore = Math.min(100, edge.trustScore + 2);
    } else {
      edge.trustScore = Math.max(0, edge.trustScore - 5);
    }
  }

  public getRelationsForAgent(agentId: string): AgentRelation[] {
    return this.edges.filter(e => e.sourceAgentId === agentId || e.targetAgentId === agentId);
  }

  public getTrustScore(sourceId: string, targetId: string): number {
    const edge = this.edges.find(e => e.sourceAgentId === sourceId && e.targetAgentId === targetId);
    return edge ? edge.trustScore : 50;
  }
}
