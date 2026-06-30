import { Mission, Task, Agent } from "@origin/domain";
import { PromptInjectionFirewall } from "./security/PromptInjectionFirewall";

export interface PromptBuildInput {
  mission: Mission;
  task: Task;
  agent: Agent;
  memory?: string[];
  knowledge?: string[];
  systemPrompt?: string;
  userPrompt?: string;
  toolResults?: { toolName: string; input: any; result: string }[];
  availableTools?: { name: string; description: string }[];
}

export class PromptBuilder {
  private static cleanBoundaries(text: string): string {
    if (!text) return "";
    return text
      .replace(/<<<<\s*SECURE_SYSTEM_INSTRUCTIONS_START\s*>>>>/gi, "")
      .replace(/<<<<\s*SECURE_SYSTEM_INSTRUCTIONS_END\s*>>>>/gi, "")
      .replace(/<<<<\s*SYSTEM_CONTEXT_START\s*>>>>/gi, "")
      .replace(/<<<<\s*SYSTEM_CONTEXT_END\s*>>>>/gi, "")
      .replace(/<<<<\s*USER_CONTEXT_START\s*>>>>/gi, "")
      .replace(/<<<<\s*USER_CONTEXT_END\s*>>>>/gi, "")
      .replace(/\[SYSTEM\]/gi, "")
      .replace(/\[USER\]/gi, "")
      .replace(/\[ASSISTANT\]/gi, "");
  }

  private static sanitizeInput(text: string, source: string): string {
    const cleaned = this.cleanBoundaries(text);
    const firewallResult = PromptInjectionFirewall.analyze(cleaned, source);
    return firewallResult.sanitizedContent;
  }

  public static buildSystemPrompt(input: PromptBuildInput): string {
    const defaultSystem = `あなたは「${input.agent.role}」の役割を持つ高度自律型AIエージェントです。
あなたの持っているコアスキル・能力: [${input.agent.capabilities.map(c => this.cleanBoundaries(c)).join(", ")}]

以下のガイドラインと制約に基づいて、完璧な品質でタスクを実行してください。`;

    const baseSystem = input.systemPrompt ? this.sanitizeInput(input.systemPrompt, "SystemPromptOverride") : defaultSystem;

    const knowledgeSection = input.knowledge && input.knowledge.length > 0
      ? `\n### 関連する前提知識:\n${input.knowledge.map((k, i) => `${i + 1}. ${this.cleanBoundaries(k)}`).join("\n")}`
      : "";

    const toolsSection = input.availableTools && input.availableTools.length > 0
      ? `\n### 利用可能な外部ツール:\n` +
        input.availableTools.map(t => `- ${this.cleanBoundaries(t.name)}: ${this.cleanBoundaries(t.description)}`).join("\n") +
        `\n\nもしツール呼び出しが必要な場合は、回答の先頭または途中に以下のフォーマットで記述してください（テキストでの最終回答を含まないでください）:
TOOL_CALL: {"tool": "ツール名", "input": { "パラメータキー": "パラメータ値" }}

ツールが必要なく、タスクが完全に完了した場合は、最終成果物（JSON、Markdown、またはプレーンテキスト）を直接出力してください。`
      : "";

    // Strictly enforce system instructions within immutable security compartments
    return [
      "<<<< SECURE_SYSTEM_INSTRUCTIONS_START >>>>",
      baseSystem,
      knowledgeSection,
      toolsSection,
      "<<<< SECURE_SYSTEM_INSTRUCTIONS_END >>>>"
    ].filter(Boolean).join("\n");
  }

  public static buildUserPrompt(input: PromptBuildInput): string {
    const objectiveCleaned = this.sanitizeInput(input.mission.objective, "MissionObjective");
    const successCriteriaCleaned = input.mission.successCriteria.map(c => this.sanitizeInput(c, "MissionSuccessCriteria"));
    const taskDescCleaned = this.sanitizeInput(input.task.description, "TaskDescription");

    const missionSection = `### 1. 全体ミッション目的
目標: ${objectiveCleaned}
成功判定基準:
${successCriteriaCleaned.map(c => `- ${c}`).join("\n")}`;

    const taskSection = `### 2. 割り当てられた個別タスク
タスクID: ${this.cleanBoundaries(input.task.id)}
タスク詳細説明: ${taskDescCleaned}`;

    const memorySection = input.memory && input.memory.length > 0
      ? `\n### 3. エージェントの記憶（これまでの進捗・コンテキスト）:\n${input.memory.map((m, i) => `- ${this.sanitizeInput(m, `MemoryFact:${i}`)}`).join("\n")}`
      : "";

    const toolResultsSection = input.toolResults && input.toolResults.length > 0
      ? `\n### 4. 実行されたツール呼び出し履歴:\n` +
        input.toolResults.map((tr, index) => {
          const tName = this.cleanBoundaries(tr.toolName);
          const tInput = this.cleanBoundaries(JSON.stringify(tr.input));
          const tResult = this.sanitizeInput(tr.result, `ToolResult:${tName}:${index}`);
          return `[回数 ${index + 1}] ツール名: ${tName}\n実行引数: ${tInput}\n実行結果: ${tResult}`;
        }).join("\n---\n")
      : "";

    const customPromptSection = input.userPrompt ? `\n### 5. 追加指示・フィードバック\n${this.sanitizeInput(input.userPrompt, "UserFeedback")}` : "";

    return [
      "<<<< SECURE_USER_CONTEXT_START >>>>",
      missionSection,
      taskSection,
      memorySection,
      toolResultsSection,
      customPromptSection,
      "\n完了したら、すべての判定基準を満たすよう、詳細かつ論理的な回答を作成してください。",
      "<<<< SECURE_USER_CONTEXT_END >>>>"
    ].filter(Boolean).join("\n\n");
  }
}
