export interface RuntimeConfig {
  maxAttempts: number;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  model: string;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  maxAttempts: 3,
  timeoutMs: 30000,
  temperature: 0.7,
  maxTokens: 2048,
  // Using gemini-3.5-flash as the default model per standard text task guidelines
  model: "gemini-3.5-flash",
};
