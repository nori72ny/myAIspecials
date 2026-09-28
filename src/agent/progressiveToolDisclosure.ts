import type { OriginCapability } from "../lib/orchestration/OriginCapabilityRouter.js";
import { toolRegistry, type ToolName } from "./toolRegistry.js";

export interface OriginToolDescriptor {
  readonly name: ToolName;
  readonly description: string;
  readonly sideEffects: "none" | "write";
  readonly requiresApproval: true;
}

const CAPABILITY_TOOLS: Readonly<Record<OriginCapability, readonly ToolName[]>> = {
  answer: ["document_generator"],
  research: ["web_search_grounding", "document_generator"],
  coding: [
    "repository_explorer",
    "file_reader",
    "file_writer",
    "verification_runner",
    "code_interpreter",
  ],
  writing: ["document_generator"],
  analysis: ["code_interpreter", "document_generator"],
} as const;

const MAX_DISCLOSED_TOOLS = 6;

export function listOriginToolsForCapability(
  capability: OriginCapability,
): readonly OriginToolDescriptor[] {
  return Object.freeze(
    CAPABILITY_TOOLS[capability]
      .slice(0, MAX_DISCLOSED_TOOLS)
      .map((name) => {
        const tool = toolRegistry[name];
        return Object.freeze({
          name: tool.name,
          description: tool.description,
          sideEffects: tool.sideEffects,
          requiresApproval: true as const,
        });
      }),
  );
}

export function isOriginToolDisclosedForCapability(
  capability: OriginCapability,
  toolName: ToolName,
): boolean {
  return CAPABILITY_TOOLS[capability].includes(toolName);
}
