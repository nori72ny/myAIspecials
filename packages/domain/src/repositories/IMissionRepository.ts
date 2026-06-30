import { MissionId } from "../types/BrandedTypes";
import { Mission } from "../mission/Mission";

export interface IMissionRepository {
  findById(id: MissionId): Promise<Mission | null>;
  save(mission: Mission, expectedVersion?: number): Promise<void>;
}
