import { IMissionRepository, ITaskRepository, createMissionId } from "@origin/domain";

export class GetMissionStatusUseCase {
  constructor(
    private missionRepo: IMissionRepository,
    private taskRepo: ITaskRepository
  ) {}

  async execute(missionIdStr: string) {
    const missionId = createMissionId(missionIdStr);
    const mission = await this.missionRepo.findById(missionId);
    if (!mission) throw new Error("Mission not found");

    const tasks = await Promise.all(mission.taskGraph.getTasks().map(id => this.taskRepo.findById(id)));
    
    return {
      mission: {
        id: mission.id,
        objective: mission.objective,
        status: mission.status,
      },
      tasks: tasks.filter(t => t !== null).map(t => ({
        id: t!.id,
        description: t!.description,
        status: t!.status,
        result: t!.result
      }))
    };
  }
}
