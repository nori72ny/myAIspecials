import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { Logger } from "../../infrastructure/logging/Logger";
import { GeminiLLMClient } from "../../infrastructure/ai/GeminiLLMClient";
import {
  ExecutiveBrainOrchestrator,
  IntentEngine,
  ContextEngine,
  RequirementDiscoveryEngine,
  KnowledgeEngine,
  StrategyEngine,
  WorkflowPlanner,
  CapabilitySelector,
  ToolSelector,
  ProviderSelector,
  QualityPredictor,
  Auditor,
  LearningEngine
} from "../../application/executive/ExecutiveBrain";

export const createExecutiveRouter = (llmClient: GeminiLLMClient) => {
  const router = Router();

  // Instantiate all modular brain engines
  const intentEngine = new IntentEngine(llmClient);
  const contextEngine = new ContextEngine();
  const requirementEngine = new RequirementDiscoveryEngine(llmClient);
  const knowledgeEngine = new KnowledgeEngine();
  const strategyEngine = new StrategyEngine(llmClient);
  const workflowPlanner = new WorkflowPlanner(llmClient);
  const capabilitySelector = new CapabilitySelector();
  const toolSelector = new ToolSelector();
  const providerSelector = new ProviderSelector();
  const qualityPredictor = new QualityPredictor();
  const auditor = new Auditor(llmClient);
  const learningEngine = new LearningEngine();

  // Master Orchestrator Injection
  const orchestrator = new ExecutiveBrainOrchestrator(
    intentEngine,
    contextEngine,
    requirementEngine,
    knowledgeEngine,
    strategyEngine,
    workflowPlanner,
    capabilitySelector,
    toolSelector,
    providerSelector,
    qualityPredictor,
    auditor,
    learningEngine,
    llmClient
  );

  // POST /api/v1/executive/run
  router.post("/run", asyncHandler(async (req, res) => {
    const { input, userId } = req.body;

    if (!input || typeof input !== "string" || input.trim() === "") {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request parameter 'input' is required and must be a non-empty string."
        }
      });
      return;
    }

    Logger.info(`ExecutiveBrain: Processing input request - "${input}"`);
    const pipelineResult = await orchestrator.process(input, userId || "system-admin");

    res.status(200).json({
      success: true,
      data: pipelineResult
    });
  }));

  return router;
};
