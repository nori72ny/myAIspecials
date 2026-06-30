import { createMissionId } from "../types/BrandedTypes";
import { Mission } from "./Mission";
import * as crypto from "crypto";

export class MissionFactory {
  static createNewMission(objective: string, successCriteria: string[]): Mission {
    const id = createMissionId(`MS-${crypto.randomUUID()}`);
    return Mission.create(id, objective, successCriteria);
  }
}
