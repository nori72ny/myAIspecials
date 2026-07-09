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

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  speed: number;       // 1-10
  cost: number;        // 1-10
  quality: number;     // 1-10
  failureRate: number; // 0.0 - 1.0
  available: boolean;
  specialties: AICapability[];
}

export interface RoutingRequest {
  input: string;
  priority?: "speed" | "cost" | "quality";
}

export interface RoutingResponse {
  primaryAI: AIModel;
  secondaryAIs: AIModel[];
  integrationAI?: AIModel;
  extractedCapabilities: AICapability[];
  needsIntegration: boolean;
}
