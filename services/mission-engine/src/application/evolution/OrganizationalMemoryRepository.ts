import { OrganizationalMemory } from "./EvolutionTypes";

export class OrganizationalMemoryRepository {
  private memories: OrganizationalMemory[] = [];
  
  private static instance: OrganizationalMemoryRepository;

  private constructor() {}

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
