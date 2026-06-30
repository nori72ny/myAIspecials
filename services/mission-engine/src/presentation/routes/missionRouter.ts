import { Router } from "express";
import { PlanMissionUseCase } from "../../application/usecases/PlanMissionUseCase";
import { ExecuteMissionUseCase } from "../../application/usecases/ExecuteMissionUseCase";
import { GetMissionStatusUseCase } from "../../application/usecases/GetMissionStatusUseCase";
import { InMemoryMissionRepository } from "../../infrastructure/database/InMemoryMissionRepository";
import { InMemoryTaskRepository } from "../../infrastructure/database/InMemoryTaskRepository";
import { GeminiLLMClient } from "../../infrastructure/ai/GeminiLLMClient";
import { InMemoryAgentRepository } from "../../infrastructure/registry/InMemoryAgentRepository";
import { asyncHandler } from "../middlewares/asyncHandler";
import { Logger } from "../../infrastructure/logging/Logger";

export const createMissionRouter = (
  missionRepo: InMemoryMissionRepository,
  taskRepo: InMemoryTaskRepository,
  llmClient: GeminiLLMClient,
  agentRepo: InMemoryAgentRepository
) => {
  const router = Router();
  
  const planMissionUseCase = new PlanMissionUseCase(missionRepo, taskRepo, llmClient);
  const executeMissionUseCase = new ExecuteMissionUseCase(missionRepo, taskRepo, agentRepo, llmClient);
  const getMissionStatusUseCase = new GetMissionStatusUseCase(missionRepo, taskRepo);

  // Plan a new mission
  router.post("/", asyncHandler(async (req, res) => {
    const { objective } = req.body;
    
    if (!objective || typeof objective !== "string" || objective.trim() === "") {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body parameter 'objective' is required and must be a non-empty string."
        }
      });
      return;
    }

    Logger.info(`API Request: Plan new mission - objective: "${objective}"`);
    const mission = await planMissionUseCase.execute(objective);
    
    res.status(201).json({
      success: true,
      id: mission.id,
      objective: mission.objective,
      status: mission.status,
      version: mission.version
    });
  }));

  // Execute a planned mission (Background/Async trigger)
  router.post("/:id/execute", asyncHandler(async (req, res) => {
    const missionId = req.params.id;
    Logger.info(`API Request: Execute mission - ID: ${missionId}`);
    
    // Trigger in background but catch failures to log and report in metrics
    executeMissionUseCase.execute(missionId).catch(err => {
      Logger.error(`Background execution failed for mission: ${missionId}`, err);
    });

    res.status(202).json({
      success: true,
      message: "Mission execution initiated in background",
      missionId
    });
  }));

  // Fetch detailed status of a mission and its task graph
  router.get("/:id", asyncHandler(async (req, res) => {
    const missionId = req.params.id;
    Logger.info(`API Request: Get mission status - ID: ${missionId}`);
    
    const status = await getMissionStatusUseCase.execute(missionId);
    res.json({
      success: true,
      ...status
    });
  }));

  return router;
};
