/**
 * Plugin System - Core Interfaces
 *
 * Core Kernel should only depend on these interfaces.
 * Implementations (Plugins) will depend on these interfaces.
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
}

export interface IPlugin {
  manifest: PluginManifest;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export type AICapability =
  | "Reasoning"
  | "Research"
  | "Text Generation"
  | "Image Generation"
  | "Code"
  | "Math"
  | "Law"
  | "Medical"
  | "Marketing"
  | "Presentation";

export interface AIProviderManifest extends PluginManifest {
  provider: string;
  models: {
    id: string;
    name: string;
    speed: number;       // 1-10
    cost: number;        // 1-10
    quality: number;     // 1-10
    failureRate: number; // 0.0 - 1.0
    specialties: AICapability[];
  }[];
}

export interface IAIProviderPlugin extends IPlugin {
  manifest: AIProviderManifest;
  generateText(modelId: string, prompt: string, options?: any): Promise<string>;
  generateImage?(modelId: string, prompt: string, options?: any): Promise<string>;
}

export interface ToolManifest extends PluginManifest {
  tools: {
    name: string;
    description: string;
    parameters: any; // JSON Schema
  }[];
}

export interface IToolPlugin extends IPlugin {
  manifest: ToolManifest;
  executeTool(toolName: string, args: Record<string, any>): Promise<any>;
}

export interface MemoryManifest extends PluginManifest {
  storageType: "in-memory" | "database" | "redis" | "vector";
}

export interface IMemoryPlugin extends IPlugin {
  manifest: MemoryManifest;
  save(key: string, value: any, tags?: string[]): Promise<void>;
  load(key: string): Promise<any>;
  search(query: string, limit?: number): Promise<any[]>;
}

export interface WorkflowManifest extends PluginManifest {
  engineType: "dag" | "sequential" | "custom";
}

export interface IWorkflowPlugin extends IPlugin {
  manifest: WorkflowManifest;
  executeWorkflow(workflowId: string, initialContext: any): Promise<any>;
  registerNodeHandler(nodeType: string, handler: (context: any) => Promise<any>): void;
}

export interface UIPluginManifest extends PluginManifest {
  mountPoint: "sidebar" | "dashboard" | "settings";
}

export interface IUIPlugin extends IPlugin {
  manifest: UIPluginManifest;
  render(): any; // React Component or generic VDOM
}
