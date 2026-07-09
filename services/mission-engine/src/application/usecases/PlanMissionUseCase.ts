import { Mission, MissionFactory, IMissionRepository, ITaskRepository, Task, createTaskId, createUserId } from "@origin/domain";
import { ILLMClient } from "../../infrastructure/ai/ILLMClient";
import { Logger } from "../../infrastructure/logging/Logger";

export class PlanMissionUseCase {
  constructor(
    private missionRepo: IMissionRepository,
    private taskRepo: ITaskRepository,
    private llmClient: ILLMClient
  ) {}

  async execute(objective: string): Promise<Mission> {
    Logger.info(`Planning mission for objective: "${objective}"`);

    const systemPrompt = "あなたはミッションプランナーです。ユーザーの目的を達成するためのタスクを洗い出し、JSON配列形式で出力してください。フォーマット: [{\"description\": \"...\", \"capability\": \"DESIGN\"}]";
    const prompt = `目的: ${objective}\n必要なタスクを抽出してください。JSONの配列のみを出力してください。`;
    
    let taskList: { description: string, capability: string }[] = [];
    try {
      const response = await this.llmClient.generateText(prompt, systemPrompt, "gemini-3.5-flash");
      const jsonStr = response.replace(/```json/g, "").replace(/```/g, "").trim();
      taskList = JSON.parse(jsonStr);
    } catch (e) {
      Logger.error("Failed to parse task list from LLM planning", e);
      taskList = [{ description: "一般タスクを実行する", capability: "ASSIST" }];
    }

    const successCriteria = ["Task completed", "Objective met", "Quality checked"];
    
    // === START TRANSACTION ===
    const mission = MissionFactory.createNewMission(objective, successCriteria);

    for (const t of taskList) {
      const taskId = createTaskId(`TSK-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
      const task = new Task(taskId, mission.id, t.description);
      await this.taskRepo.save(task);
      mission.taskGraph.addTask(taskId);
    }

    const adminUser = createUserId("system-admin");
    mission.approve(adminUser);
    mission.activate();

    await this.missionRepo.save(mission);
    // === COMMIT TRANSACTION ===

    Logger.info(`Mission ${mission.id} successfully created and activated with ${taskList.length} tasks.`);
    return mission;
  }
}

