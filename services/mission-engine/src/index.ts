import { Router } from "express";
import { InMemoryMissionRepository } from "./infrastructure/database/InMemoryMissionRepository";
import { InMemoryTaskRepository } from "./infrastructure/database/InMemoryTaskRepository";
import { GeminiLLMClient } from "./infrastructure/ai/GeminiLLMClient";
import { InMemoryAgentRepository } from "./infrastructure/registry/InMemoryAgentRepository";
import { createMissionRouter } from "./presentation/routes/missionRouter";
import { createTaskRouter } from "./presentation/routes/taskRouter";
import { createAgentRouter } from "./presentation/routes/agentRouter";
import { createHealthRouter } from "./presentation/routes/healthRouter";
import { createOrganizationRouter } from "./application/organization/DashboardAPI";
import { errorHandler } from "./presentation/middlewares/errorHandler";

export const initMissionEngine = (): Router => {
  // 1. Dependency Injection setup
  const missionRepo = new InMemoryMissionRepository();
  const taskRepo = new InMemoryTaskRepository();
  const llmClient = new GeminiLLMClient();
  const agentRepo = new InMemoryAgentRepository();

  // 2. Main Router
  const router = Router();
  
  // 3. Mount sub-routers
  router.use("/health", createHealthRouter());
  router.use("/missions", createMissionRouter(missionRepo, taskRepo, llmClient, agentRepo));
  router.use("/tasks", createTaskRouter(taskRepo));
  router.use("/agents", createAgentRouter(agentRepo));
  router.use("/organizations", createOrganizationRouter());

  // 4. Centralized error handling middleware (MUST be loaded after all routers)
  router.use(errorHandler);

  return router;
};
