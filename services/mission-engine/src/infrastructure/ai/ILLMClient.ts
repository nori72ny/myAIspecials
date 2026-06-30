export interface ILLMClient {
  generateText(prompt: string, systemPrompt?: string, model?: string): Promise<string>;
}
