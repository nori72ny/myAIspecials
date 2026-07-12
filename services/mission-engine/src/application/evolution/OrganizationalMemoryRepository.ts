import { OrganizationalMemory } from "./EvolutionTypes";
import { generateIntelligenceDNA } from "./DNAGenerator";

export class OrganizationalMemoryRepository {
  private memories: OrganizationalMemory[] = [];
  
  private static instance: OrganizationalMemoryRepository;

  private constructor() {
    // Pre-populate with 3 rich historical memories (Intelligence DNA)
    const mission1 = "MSN-0001";
    const mission2 = "MSN-0042";
    const mission3 = "MSN-0105";

    this.memories = [
      {
        id: "mem-hist-1",
        missionId: mission1,
        success: true,
        score: 98.5,
        successStories: ["毎日の習慣化タスク管理 - パターン #1 completed successfully with 100% consensus."],
        failureStories: [],
        improvements: ["Executive Action: RESOURCE_ALLOCATION - Spawning Web Search Swarm Agent"],
        kpiSnapshot: { activeTasks: 3, deliverables: 2, reviews: 3, consensusRounds: 1 },
        timestamp: new Date(Date.now() - 3600000 * 2), // 2 hours ago
        intelligenceDNA: generateIntelligenceDNA(mission1, true, 98.5)
      },
      {
        id: "mem-hist-2",
        missionId: mission2,
        success: true,
        score: 97.2,
        successStories: ["主要クラウドAIコスト・性能比較 - パターン #1 completed successfully with 100% consensus."],
        failureStories: [],
        improvements: ["Executive Action: RESOURCE_ALLOCATION - Spawning Math & Stats Specialist Agent"],
        kpiSnapshot: { activeTasks: 4, deliverables: 3, reviews: 4, consensusRounds: 1 },
        timestamp: new Date(Date.now() - 3600000 * 5), // 5 hours ago
        intelligenceDNA: generateIntelligenceDNA(mission2, true, 97.2)
      },
      {
        id: "mem-hist-3",
        missionId: mission3,
        success: true,
        score: 95.8,
        successStories: ["TOEIC 800点突破のための3ヶ月英語コーチング計画 completed successfully with 100% consensus."],
        failureStories: [],
        improvements: ["Executive Action: RESOURCE_ALLOCATION - Spawning Multilingual Translation Co-pilot"],
        kpiSnapshot: { activeTasks: 5, deliverables: 4, reviews: 5, consensusRounds: 2 },
        timestamp: new Date(Date.now() - 3600000 * 12), // 12 hours ago
        intelligenceDNA: generateIntelligenceDNA(mission3, true, 95.8)
      }
    ];
  }

  public static getInstance(): OrganizationalMemoryRepository {
    if (!OrganizationalMemoryRepository.instance) {
      OrganizationalMemoryRepository.instance = new OrganizationalMemoryRepository();
    }
    return OrganizationalMemoryRepository.instance;
  }

  public save(memory: OrganizationalMemory) {
    this.memories.push(memory);
  }

  public getAll(): OrganizationalMemory[] {
    return this.memories;
  }

  public getByMissionId(missionId: string): OrganizationalMemory | undefined {
    return this.memories.find(m => m.missionId === missionId);
  }
}
