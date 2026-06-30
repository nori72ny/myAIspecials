import { Scenario } from "./StrategicTypes";

export class ScenarioPlanner {
  public generateScenarios(missionDescription: string): Scenario[] {
    return [
      {
        type: "BEST",
        description: "Flawless execution, zero escalations, high quality output.",
        probability: 0.2,
        impactScore: 100
      },
      {
        type: "EXPECTED",
        description: "Minor delays in review, 1-2 consensus rounds, standard quality.",
        probability: 0.6,
        impactScore: 75
      },
      {
        type: "WORST",
        description: "Multiple escalations, consensus deadlock, high resource drain.",
        probability: 0.2,
        impactScore: 30
      }
    ];
  }
}
