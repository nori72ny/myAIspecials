import { CorporateGoal } from "./StrategicTypes";

export class CorporateGoalManager {
  private goals: CorporateGoal[] = [
    {
      id: "goal-1",
      level: "LONG_TERM",
      description: "Achieve AGI-level organizational autonomy.",
      targetMetrics: { "autonomyLevel": 100 },
      currentProgress: 45
    },
    {
      id: "goal-2",
      level: "QUARTER",
      description: "Reduce average mission time by 20%.",
      targetMetrics: { "avgMissionTimeMin": 15 },
      currentProgress: 60
    }
  ];

  private static instance: CorporateGoalManager;

  private constructor() {}

  public static getInstance(): CorporateGoalManager {
    if (!CorporateGoalManager.instance) {
      CorporateGoalManager.instance = new CorporateGoalManager();
    }
    return CorporateGoalManager.instance;
  }

  public getGoals(): CorporateGoal[] {
    return this.goals;
  }

  public addGoal(goal: CorporateGoal) {
    this.goals.push(goal);
  }

  public calculateAlignmentScore(missionDescription: string): number {
    return 85 + Math.random() * 10;
  }
}
