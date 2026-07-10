import { UserDNAProfile, DNAEvent } from "./types";
import { dnaRepository } from "./DNARepository";

export class DNAEngine {
  private static instance: DNAEngine;
  private profile: UserDNAProfile | null = null;
  private initialized = false;

  private constructor() {}

  public static getInstance(): DNAEngine {
    if (!DNAEngine.instance) {
      DNAEngine.instance = new DNAEngine();
    }
    return DNAEngine.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.profile = await dnaRepository.loadProfile();
    this.initialized = true;
    console.log("[DNAEngine] Initialized with profile:", this.profile);
  }

  public getProfile(): UserDNAProfile {
    if (!this.profile) {
      throw new Error("DNAEngine not initialized");
    }
    return this.profile;
  }

  public async recordEvent(event: DNAEvent): Promise<void> {
    if (!this.initialized || !this.profile) await this.initialize();

    // Simple learning logic for demonstration
    // Over time, this would use a more sophisticated local ML model or Bayesian updating
    const p = this.profile!;
    p.lastUpdated = Date.now();

    if (event.type === "UI_INTERACTION") {
      const { action, value } = event.context;
      if (action === "change_theme") {
        p.preferences.theme = value;
      }
      if (action === "change_density") {
        p.preferences.density = value;
      }
    } else if (event.type === "CONTENT_PREFERENCE") {
      const { trait, weightChange } = event.context;
      if (trait) {
        const currentWeight = p.learningWeights[trait] || 0.5;
        // Exponential moving average update
        p.learningWeights[trait] = Math.max(0, Math.min(1, currentWeight * 0.9 + (weightChange || 1.0) * 0.1));
      }
    }

    await dnaRepository.saveProfile(p);
  }

  public getPersonalizationContext(): string {
    if (!this.profile) return "";
    return `User DNA Preferences: Tone is ${this.profile.cognitiveStyle.tone}, Verbosity is ${this.profile.cognitiveStyle.verbosity}. Preferred language is ${this.profile.cognitiveStyle.language}. Adapt UI density to ${this.profile.preferences.density}.`;
  }
}

export const dnaEngine = DNAEngine.getInstance();
