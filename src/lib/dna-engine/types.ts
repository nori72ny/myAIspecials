export interface UserDNAProfile {
  id: string;
  preferences: {
    theme: "light" | "dark" | "system";
    typography: "sans" | "serif" | "mono";
    density: "comfortable" | "compact" | "spacious";
    animationSpeed: "fast" | "normal" | "reduced";
    colorPalette: string;
  };
  cognitiveStyle: {
    verbosity: "concise" | "balanced" | "detailed";
    tone: "professional" | "casual" | "academic" | "direct";
    decisionMaking: "data-driven" | "intuitive" | "consensus";
    language: string;
  };
  workflowHabits: {
    mostUsedCapabilities: string[];
    typicalWorkingHours: string;
    frequentIntegrations: string[];
  };
  learningWeights: Record<string, number>; // Adjusts over time (e.g. { "likes_charts": 0.8, "prefers_bullet_points": 0.9 })
  version: number;
  lastUpdated: number;
}

export interface DNAEvent {
  type: "UI_INTERACTION" | "CONTENT_PREFERENCE" | "WORKFLOW_PATTERN" | "EXPLICIT_FEEDBACK";
  timestamp: number;
  context: Record<string, any>;
  weight: number; // 0.0 to 1.0 depending on how strong the signal is
}
