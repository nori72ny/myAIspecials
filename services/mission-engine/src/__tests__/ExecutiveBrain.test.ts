import { describe, it, expect, beforeEach, vi } from "vitest";
import { ILLMClient } from "../infrastructure/ai/ILLMClient";
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
} from "../application/executive/ExecutiveBrain";

class MockLLMClient implements ILLMClient {
  public generateText = vi.fn().mockImplementation(async (prompt: string, systemPrompt?: string) => {
    if (systemPrompt && systemPrompt.includes("Analyze user intent")) {
      return JSON.stringify({
        category: "CREATE_MISSION",
        confidence: 0.98,
        extractedDirectives: ["Build system architecture"]
      });
    }
    if (systemPrompt && systemPrompt.includes("Analyze input & context for completeness")) {
      return JSON.stringify({
        hasMissingInfo: false,
        discoveredRequirements: ["Setup database schema", "Configure router"],
        clarifyingQuestions: [],
        constraints: ["Latency < 200ms"]
      });
    }
    if (systemPrompt && systemPrompt.includes("Create a strategic directive")) {
      return JSON.stringify({
        coreObjective: "Deploy high scalability microservices",
        scopeBoundaries: ["Limit scope to AWS us-east-1"],
        strategicPriority: "QUALITY"
      });
    }
    if (systemPrompt && systemPrompt.includes("Plan sequential steps")) {
      return JSON.stringify({
        steps: [
          {
            id: "step-1",
            title: "Analysis Step",
            description: "Analyze current performance characteristics",
            dependsOn: [],
            assignedCapabilities: ["ANALYSIS"],
            resolvedTools: ["knowledge_reader"]
          },
          {
            id: "step-2",
            title: "Implementation Step",
            description: "Code the optimization modules",
            dependsOn: ["step-1"],
            assignedCapabilities: ["IMPLEMENTATION"],
            resolvedTools: ["surgical_code_editor"]
          }
        ],
        estimatedTotalCost: 0.045
      });
    }
    if (systemPrompt && systemPrompt.includes("Perform a cognitive code")) {
      return JSON.stringify({
        isValid: true,
        score: 97,
        securityCheckPassed: true,
        critique: "Excellent design choices",
        safetyRating: "SAFE"
      });
    }
    return "Generic success response from Mock LLM";
  });
}

describe("=== Executive Brain Unit & Integration Tests ===", () => {
  let mockLLM: MockLLMClient;
  let intentEngine: IntentEngine;
  let contextEngine: ContextEngine;
  let requirementEngine: RequirementDiscoveryEngine;
  let knowledgeEngine: KnowledgeEngine;
  let strategyEngine: StrategyEngine;
  let workflowPlanner: WorkflowPlanner;
  let capabilitySelector: CapabilitySelector;
  let toolSelector: ToolSelector;
  let providerSelector: ProviderSelector;
  let qualityPredictor: QualityPredictor;
  let auditor: Auditor;
  let learningEngine: LearningEngine;
  let orchestrator: ExecutiveBrainOrchestrator;

  beforeEach(() => {
    mockLLM = new MockLLMClient();
    intentEngine = new IntentEngine(mockLLM);
    contextEngine = new ContextEngine();
    requirementEngine = new RequirementDiscoveryEngine(mockLLM);
    knowledgeEngine = new KnowledgeEngine();
    strategyEngine = new StrategyEngine(mockLLM);
    workflowPlanner = new WorkflowPlanner(mockLLM);
    capabilitySelector = new CapabilitySelector();
    toolSelector = new ToolSelector();
    providerSelector = new ProviderSelector();
    qualityPredictor = new QualityPredictor();
    auditor = new Auditor(mockLLM);
    learningEngine = new LearningEngine();

    orchestrator = new ExecutiveBrainOrchestrator(
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
      mockLLM
    );
  });

  describe("1. Individual Engine Units", () => {
    it("IntentEngine should analyze intent correctly via LLM", async () => {
      const intent = await intentEngine.analyzeIntent("Create high performance cache");
      expect(intent.category).toBe("CREATE_MISSION");
      expect(intent.confidence).toBe(0.98);
      expect(intent.extractedDirectives).toContain("Build system architecture");
    });

    it("IntentEngine should degrade gracefully to fallback on LLM failure", async () => {
      mockLLM.generateText.mockRejectedValueOnce(new Error("API Timeout"));
      const intent = await intentEngine.analyzeIntent("Please do diagnostic on server");
      expect(intent.category).toBe("DIAGNOSTIC");
      expect(intent.confidence).toBe(0.7);
    });

    it("ContextEngine should manage contexts with local key-value state", async () => {
      const ctx = await contextEngine.retrieveContext("test-user");
      expect(ctx.userId).toBe("test-user");
      
      ctx.activeMissions.push("mission-abc");
      await contextEngine.updateContext("test-user", ctx);
      
      const updated = await contextEngine.retrieveContext("test-user");
      expect(updated.activeMissions).toContain("mission-abc");
    });

    it("RequirementDiscoveryEngine should discover missing info and constraints", async () => {
      const intent = { rawInput: "Run", category: "GENERAL" as const, confidence: 1, extractedDirectives: [] };
      const context = await contextEngine.retrieveContext("user-1");
      const result = await requirementEngine.discoverRequirements(intent, context);
      expect(result.discoveredRequirements).toContain("Setup database schema");
    });

    it("KnowledgeEngine should inject contextual specifications correctly", async () => {
      const intent = { rawInput: "Deploy to Vercel", category: "GENERAL" as const, confidence: 1, extractedDirectives: [] };
      const context = await contextEngine.retrieveContext("user-1");
      const payload = await knowledgeEngine.injectKnowledge(intent, context);
      expect(payload.sources).toContain("Vercel Deployment Guide");
      expect(payload.injectedContext).toContain("vercel.json");
    });

    it("StrategyEngine should formulate solid core objectives", async () => {
      const intent = { rawInput: "Deploy high-scale", category: "GENERAL" as const, confidence: 1, extractedDirectives: [] };
      const requirements = { hasMissingInfo: false, discoveredRequirements: [], clarifyingQuestions: [], constraints: [] };
      const knowledge = { sources: [], injectedContext: "" };
      const strategy = await strategyEngine.formulateStrategy(intent, requirements, knowledge);
      expect(strategy.coreObjective).toBe("Deploy high scalability microservices");
      expect(strategy.strategicPriority).toBe("QUALITY");
    });

    it("WorkflowPlanner should plan milestones and compute cost", async () => {
      const strategy = { coreObjective: "Deploy", scopeBoundaries: [], strategicPriority: "QUALITY" as const };
      const plan = await workflowPlanner.planWorkflow(strategy);
      expect(plan.steps.length).toBe(2);
      expect(plan.steps[0].title).toBe("Analysis Step");
      expect(plan.estimatedTotalCost).toBe(0.045);
    });

    it("CapabilitySelector should route capabilities based on config", async () => {
      const step = { id: "1", title: "Test", description: "", dependsOn: [], assignedCapabilities: ["ANALYSIS"], resolvedTools: [], status: "PENDING" as const };
      const caps = await capabilitySelector.selectCapabilities(step);
      expect(caps).toContain("ANALYSIS");
    });

    it("ToolSelector should map capabilities to surgical execution tools", async () => {
      const tools = await toolSelector.resolveTools(["IMPLEMENTATION", "TESTING"]);
      expect(tools).toContain("surgical_code_editor");
      expect(tools).toContain("compiler_sandbox");
    });

    it("ProviderSelector should select specific provider SLAs dynamically", async () => {
      const strategy = { coreObjective: "Deploy", scopeBoundaries: [], strategicPriority: "QUALITY" as const };
      const selection = await providerSelector.selectProvider(["IMPLEMENTATION"], strategy);
      expect(selection.modelId).toBe("openai");
      expect(selection.providerName).toContain("GPT-4o");
    });

    it("QualityPredictor should predict confidence levels prior to run", async () => {
      const selection = { modelId: "openai", providerName: "GPT-4o", estimatedLatency: 500, reason: "Fast" };
      const prediction = await qualityPredictor.predictQuality(selection, "Code optimization");
      expect(prediction.predictedScore).toBeGreaterThan(90);
      expect(prediction.hallucinationRisk).toBe("LOW");
    });

    it("Auditor should grade executing agent outputs thoroughly", async () => {
      const step = { id: "1", title: "Code Module", description: "", dependsOn: [], assignedCapabilities: [], resolvedTools: [], status: "PENDING" as const };
      const result = await auditor.auditExecution(step, "export const main = () => {}");
      expect(result.isValid).toBe(true);
      expect(result.score).toBe(97);
    });

    it("LearningEngine should adapt model selection weights based on telemetry", async () => {
      const initial = await learningEngine.optimizeWeights("openai", 1200, true);
      expect(initial.weight).toBeLessThan(1.0); // Penalized slightly for latency > 800ms
      
      const failed = await learningEngine.optimizeWeights("openai", 300, false);
      expect(failed.weight).toBeLessThan(initial.weight); // Heavily penalized for failure
    });
  });

  describe("2. Master Orchestrator Integration Pipeline", () => {
    it("should successfully run the full twelve-engine cognitive pipeline from User Input to Delivery", async () => {
      const eventsCaptured: string[] = [];
      orchestrator.events.on("IntentUnderstood", () => eventsCaptured.push("IntentUnderstood"));
      orchestrator.events.on("ContextResolved", () => eventsCaptured.push("ContextResolved"));
      orchestrator.events.on("RequirementsDiscovered", () => eventsCaptured.push("RequirementsDiscovered"));
      orchestrator.events.on("KnowledgeInjected", () => eventsCaptured.push("KnowledgeInjected"));
      orchestrator.events.on("StrategyFormulated", () => eventsCaptured.push("StrategyFormulated"));
      orchestrator.events.on("WorkflowPlanned", () => eventsCaptured.push("WorkflowPlanned"));
      orchestrator.events.on("ExecutionStepStarted", () => eventsCaptured.push("ExecutionStepStarted"));
      orchestrator.events.on("ExecutionStepCompleted", () => eventsCaptured.push("ExecutionStepCompleted"));
      orchestrator.events.on("AuditCompleted", () => eventsCaptured.push("AuditCompleted"));
      orchestrator.events.on("BrainPipelineFinished", () => eventsCaptured.push("BrainPipelineFinished"));

      const result = await orchestrator.process("Build scalable microservice", "user-123");

      expect(result.intent.category).toBe("CREATE_MISSION");
      expect(result.requirements.hasMissingInfo).toBe(false);
      expect(result.strategy.strategicPriority).toBe("QUALITY");
      expect(result.workflow.steps.length).toBe(2);
      expect(result.finalAuditScore).toBe(97);
      expect(result.outputSummary).toContain("ACOS 2.0 Executive Brain Orchestration Summary");

      // Verify event-driven dispatching
      expect(eventsCaptured).toContain("IntentUnderstood");
      expect(eventsCaptured).toContain("ContextResolved");
      expect(eventsCaptured).toContain("RequirementsDiscovered");
      expect(eventsCaptured).toContain("KnowledgeInjected");
      expect(eventsCaptured).toContain("StrategyFormulated");
      expect(eventsCaptured).toContain("WorkflowPlanned");
      expect(eventsCaptured).toContain("ExecutionStepStarted");
      expect(eventsCaptured).toContain("ExecutionStepCompleted");
      expect(eventsCaptured).toContain("AuditCompleted");
      expect(eventsCaptured).toContain("BrainPipelineFinished");
    });
  });
});
