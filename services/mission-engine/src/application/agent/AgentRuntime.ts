import { Mission, Task, Agent } from "@origin/domain";
import { ILLMClient } from "../../infrastructure/ai/ILLMClient";
import { PromptBuilder } from "./PromptBuilder";
import { ToolExecutor, ToolResult } from "./ToolExecutor";
import { OutputValidator, OutputFormat } from "./OutputValidator";
import { ReflectionEngine, ReflectionResult } from "./ReflectionEngine";
import { RuntimeConfig, DEFAULT_RUNTIME_CONFIG } from "./RuntimeConfig";
import { RuntimeMetrics } from "./RuntimeMetrics";
import { withTimeout } from "../runtime/Timeout";
import { MemoryManager, ContextResolver } from "./ExecutionMemory";
import { SafetyPolicyEngine } from "./security/SafetyPolicyEngine";
import { ToolOutputSanitizer } from "./security/ToolOutputSanitizer";
import { IsolatedCompartmentManager } from "./security/ContextIsolation";

export type AgentRuntimeState = "Idle" | "Thinking" | "CallingTool" | "Reflecting" | "Completed" | "Failed";

export interface AgentExecutionResult {
  success: boolean;
  output: string;
  state: AgentRuntimeState;
  score?: number;
  attemptsUsed: number;
  feedbackHistory: string[];
}

export class AgentRuntime {
  private state: AgentRuntimeState = "Idle";
  private toolExecutor: ToolExecutor;
  private config: RuntimeConfig;
  private metrics: RuntimeMetrics;

  constructor(
    private llmClient: ILLMClient,
    config: Partial<RuntimeConfig> = {}
  ) {
    this.toolExecutor = new ToolExecutor();
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
    this.metrics = RuntimeMetrics.getInstance();
  }

  public getState(): AgentRuntimeState {
    return this.state;
  }

  private transitionTo(newState: AgentRuntimeState): void {
    this.state = newState;
  }

  /**
   * Run the full Agentic cycle: Thinking -> (CallingTool) -> Reflecting -> Completed/Failed
   */
  public async execute(
    mission: Mission,
    task: Task,
    agent: Agent,
    expectedFormat: OutputFormat = "Text"
  ): Promise<AgentExecutionResult> {
    this.transitionTo("Thinking");

    const memoryManager = MemoryManager.getInstance();
    const agentScratchpad = memoryManager.getAgentScratchpad(mission.id, task.id);
    const conversation = memoryManager.getConversationMemory(mission.id, agent.id);

    agentScratchpad.logStep(`Started executing task ${task.id}: "${task.description}"`);
    conversation.addMessage("user", `Please execute task ${task.id}: ${task.description}`);

    let currentAttempts = this.config.maxAttempts;
    let attemptsUsed = 0;
    const feedbackHistory: string[] = [];
    
    // In-context execution state
    const toolResults: { toolName: string; input: any; result: string }[] = [];
    const memory: string[] = [];

    // === SAFETY & LOOP-EXPLOSION PREVENTION ===
    const TOOL_CALL_BUDGET = 6;
    const MAX_CONSECUTIVE_FAILURES = 3;
    const MAX_IDENTICAL_TOOL_EXECUTION = 2;
    const COOLDOWN_MS = 100;

    let totalToolCallsCount = 0;
    let consecutiveToolFailures = 0;
    const executedToolCalls: Array<{ name: string; inputHash: string }> = [];
    
    // Convert successCriteria to readable strings
    const successCriteriaList = mission.successCriteria;

    let systemPromptOverride: string | undefined;
    let userPromptFeedback: string | undefined;

    while (currentAttempts > 0) {
      attemptsUsed++;
      
      // Resolve dynamic and task-shared memory context for this turn
      const resolvedMemory = ContextResolver.resolveContext(mission.id, task.id, agent.id);
      
      // Step 1: Assemble the prompts
      const systemPrompt = PromptBuilder.buildSystemPrompt({
        mission,
        task,
        agent,
        availableTools: this.toolExecutor.getToolsList(),
        systemPrompt: systemPromptOverride
      });

      const userPrompt = PromptBuilder.buildUserPrompt({
        mission,
        task,
        agent,
        memory: [...resolvedMemory, ...memory],
        knowledge: [],
        toolResults,
        userPrompt: userPromptFeedback
      });

      // Step 2: Query the LLM under timeout
      const startTime = Date.now();
      let responseText = "";
      let hasError = false;

      try {
        responseText = await withTimeout(
          this.llmClient.generateText(userPrompt, systemPrompt, this.config.model),
          this.config.timeoutMs,
          `Agent [${agent.role}] processing task [${task.id}]`
        );
      } catch (err) {
        hasError = true;
        responseText = `Execution error: ${(err as Error).message}`;
      }

      const latencyMs = Date.now() - startTime;
      
      // Estimate token counts safely (V1)
      const inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3);
      const outputTokens = Math.ceil(responseText.length / 3);

      this.metrics.record({
        agentId: agent.id,
        missionId: mission.id,
        promptLength: userPrompt.length,
        inputTokens,
        outputTokens,
        latencyMs,
        success: !hasError
      });

      if (hasError) {
        agentScratchpad.logStep(`LLM execution error: ${responseText}`);
        currentAttempts--;
        if (currentAttempts === 0) {
          this.transitionTo("Failed");
          agentScratchpad.logStep(`Execution failed after maximum attempts.`);
          return {
            success: false,
            output: responseText,
            state: "Failed",
            attemptsUsed,
            feedbackHistory
          };
        }
        userPromptFeedback = `エラーが発生しました。再試行してください: ${responseText}`;
        continue;
      }

      // Validate response safety
      const responseSafety = SafetyPolicyEngine.evaluate({
        outputPayload: responseText,
        missionId: mission.id,
        taskId: task.id
      });
      if (responseSafety === "BLOCK") {
        responseText = "Execution blocked by safety policy: Unsafe output signature detected.";
        agentScratchpad.logStep(responseText);
      }

      // Instantiate isolated context compartments to verify and protect context boundaries
      const _compartments = new IsolatedCompartmentManager(
        agent,
        systemPrompt,
        userPromptFeedback || "",
        conversation.getHistory(),
        mission,
        task,
        memoryManager.getMissionMemory(mission.id).getFacts().map(f => ({
          content: f.content,
          confidence: f.metadata?.confidence ?? 1.0,
          expiresAt: f.metadata?.expiresAt
        })),
        [...resolvedMemory, ...memory],
        toolResults,
        [],
        feedbackHistory
      );

      // Step 3: Handle V1 Tool execution loop (Multi-turn tool execution limit of 3)
      let toolExecutionCount = 0;
      const maxToolCallsPerTurn = 3;

      while (responseText.includes("TOOL_CALL:") && toolExecutionCount < maxToolCallsPerTurn) {
        this.transitionTo("CallingTool");
        toolExecutionCount++;

        const toolCallIndex = responseText.indexOf("TOOL_CALL:");
        const rawJsonString = responseText.substring(toolCallIndex + "TOOL_CALL:".length).trim();
        
        let toolName = "";
        let toolInput: any = {};

        try {
          // Parse tool JSON block
          // If there's extra text after the JSON, find matching brackets or just parse
          let cleanJson = rawJsonString;
          const firstBracket = rawJsonString.indexOf("{");
          if (firstBracket !== -1) {
            let bracketCount = 0;
            let lastBracket = -1;
            for (let i = firstBracket; i < rawJsonString.length; i++) {
              if (rawJsonString[i] === "{") bracketCount++;
              if (rawJsonString[i] === "}") {
                bracketCount--;
                if (bracketCount === 0) {
                  lastBracket = i;
                  break;
                }
              }
            }
            if (lastBracket !== -1) {
              cleanJson = rawJsonString.substring(firstBracket, lastBracket + 1);
            }
          }

          const parsedCall = JSON.parse(cleanJson);
          toolName = parsedCall.tool;
          toolInput = parsedCall.input;
        } catch (err) {
          toolResults.push({
            toolName: "Unknown",
            input: {},
            result: `Failed to parse TOOL_CALL JSON structure: ${(err as Error).message}`
          });
        }

        if (toolName) {
          // 0. Safety Policy Engine check for tool and inputs
          const executionHistory = executedToolCalls.map(c => `${c.name}:${c.inputHash}`);
          const safetyDecision = SafetyPolicyEngine.evaluate({
            toolName,
            toolInput,
            executionHistory,
            missionId: mission.id,
            taskId: task.id
          });

          if (safetyDecision === "BLOCK") {
            const errorMsg = `Tool execution blocked by safety policy engine: Unsafe action detected.`;
            agentScratchpad.logStep(errorMsg);
            toolResults.push({
              toolName,
              input: toolInput,
              result: `Error: ${errorMsg}`
            });
            responseText = responseText.replace("TOOL_CALL:", "TOOL_CALL_BLOCKED:");
            break; // Abort
          }

          // 1. Tool Call Budget Check
          if (totalToolCallsCount >= TOOL_CALL_BUDGET) {
            const errorMsg = `Tool execution aborted: Tool call budget of ${TOOL_CALL_BUDGET} exhausted.`;
            agentScratchpad.logStep(errorMsg);
            toolResults.push({
              toolName,
              input: toolInput,
              result: `Error: ${errorMsg}`
            });
            responseText = responseText.replace("TOOL_CALL:", "TOOL_CALL_ABORTED:");
            break; // Abort
          }

          // 2. Circuit Breaker Check
          if (consecutiveToolFailures >= MAX_CONSECUTIVE_FAILURES) {
            const errorMsg = `Tool execution aborted: Circuit breaker tripped due to ${consecutiveToolFailures} consecutive tool failures.`;
            agentScratchpad.logStep(errorMsg);
            toolResults.push({
              toolName,
              input: toolInput,
              result: `Error: ${errorMsg}`
            });
            responseText = responseText.replace("TOOL_CALL:", "TOOL_CALL_ABORTED:");
            break; // Abort
          }

          // 3. Duplicate Tool & Max Identical Check
          const inputHash = JSON.stringify(toolInput || {});
          const sameCalls = executedToolCalls.filter(c => c.name === toolName && c.inputHash === inputHash);
          if (sameCalls.length >= MAX_IDENTICAL_TOOL_EXECUTION) {
            const errorMsg = `Tool execution aborted: Tool "${toolName}" with identical input was executed more than ${MAX_IDENTICAL_TOOL_EXECUTION} times (Duplicate Tool Detection).`;
            agentScratchpad.logStep(errorMsg);
            toolResults.push({
              toolName,
              input: toolInput,
              result: `Error: ${errorMsg}`
            });
            responseText = responseText.replace("TOOL_CALL:", "TOOL_CALL_ABORTED:");
            break; // Abort
          }

          // 4. Cooldown
          if (COOLDOWN_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));
          }

          // Update tracking metrics
          totalToolCallsCount++;
          executedToolCalls.push({ name: toolName, inputHash });

          agentScratchpad.logStep(`Calling tool ${toolName} with input ${inputHash}`);
          const toolResult = await this.toolExecutor.executeTool(toolName, toolInput, mission.id, agent.id);
          
          if (toolResult.success) {
            consecutiveToolFailures = 0;
          } else {
            consecutiveToolFailures++;
          }

          // Write intermediate updates to Scratchpad and Agent Scratchpad
          memoryManager.getScratchpad(mission.id).write(`Executed ${toolName} with input: ${inputHash}. Success: ${toolResult.success}`);
          agentScratchpad.logStep(`Tool execution output: ${toolResult.success ? "Success" : "Failure"}`);

          // Sanitize tool output before storing
          const rawResult = toolResult.success ? toolResult.output : `Error: ${toolResult.error}`;
          const sanitizedResult = ToolOutputSanitizer.sanitize(rawResult, toolName);

          toolResults.push({
            toolName,
            input: toolInput,
            result: sanitizedResult
          });
          
          memory.push(`Used ${toolName} with input ${inputHash}.`);
        }

        // Re-query LLM with tool feedback to continue reasoning
        this.transitionTo("Thinking");
        const nextUserPrompt = PromptBuilder.buildUserPrompt({
          mission,
          task,
          agent,
          memory: [...ContextResolver.resolveContext(mission.id, task.id, agent.id), ...memory],
          toolResults,
          userPrompt: userPromptFeedback
        });

        const nextStartTime = Date.now();
        try {
          responseText = await this.llmClient.generateText(nextUserPrompt, systemPrompt, this.config.model);
        } catch (err) {
          responseText = `Tool iteration execution error: ${(err as Error).message}`;
        }
        
        const nextLatency = Date.now() - nextStartTime;
        this.metrics.record({
          agentId: agent.id,
          missionId: mission.id,
          promptLength: nextUserPrompt.length,
          inputTokens: Math.ceil((systemPrompt.length + nextUserPrompt.length) / 3),
          outputTokens: Math.ceil(responseText.length / 3),
          latencyMs: nextLatency,
          success: !responseText.startsWith("Tool iteration execution error")
        });
      }

      // Step 4: Validate format and run Reflection Engine
      this.transitionTo("Reflecting");
      
      const validation = OutputValidator.validate(responseText, expectedFormat);
      if (!validation.isValid) {
        agentScratchpad.logStep(`Format validation failed: ${validation.error}`);
        currentAttempts--;
        feedbackHistory.push(`Format validation failed: ${validation.error}`);
        if (currentAttempts === 0) {
          this.transitionTo("Failed");
          agentScratchpad.logStep(`Execution failed due to output validation failure.`);
          return {
            success: false,
            output: responseText,
            state: "Failed",
            attemptsUsed,
            feedbackHistory
          };
        }
        userPromptFeedback = `出力フォーマットを修正してください。エラー: ${validation.error}`;
        this.transitionTo("Thinking");
        continue;
      }

      const reflection = ReflectionEngine.reflect(responseText, expectedFormat, successCriteriaList);
      feedbackHistory.push(reflection.feedback);

      if (reflection.passed) {
        this.transitionTo("Completed");
        
        // Fulfilling Task-to-Task memory sharing: Save outputs and facts to compartment
        memoryManager.getTaskMemory(mission.id).recordTaskOutput(task.id, responseText);
        memoryManager.getMissionMemory(mission.id).addFact(`Task ${task.id} succeeded. Output summary: ${responseText.substring(0, 150)}`);
        
        conversation.addMessage("assistant", responseText);
        agentScratchpad.logStep(`Task execution successfully completed and verified. Score: ${reflection.score}`);

        return {
          success: true,
          output: responseText,
          state: "Completed",
          score: reflection.score,
          attemptsUsed,
          feedbackHistory
        };
      } else {
        agentScratchpad.logStep(`Quality reflection failed. Score: ${reflection.score}. Running self-correction loop.`);
        currentAttempts--;
        if (currentAttempts === 0) {
          this.transitionTo("Failed");
          agentScratchpad.logStep(`Execution failed because reflection did not pass after max attempts.`);
          return {
            success: false,
            output: responseText,
            state: "Failed",
            score: reflection.score,
            attemptsUsed,
            feedbackHistory
          };
        }
        
        // Self-correction instruction with reflection details
        userPromptFeedback = `品質判定で不合格となりました。以下のフィードバックに対応し、最高品質の成果物を再生成してください:\n${reflection.feedback}`;
        this.transitionTo("Thinking");
      }
    }

    this.transitionTo("Failed");
    agentScratchpad.logStep(`Execution terminated unexpectedly.`);
    return {
      success: false,
      output: "",
      state: "Failed",
      attemptsUsed,
      feedbackHistory
    };
  }
}
