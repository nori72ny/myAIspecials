import { UserDNAProfile } from "./types";

const DNA_STORAGE_KEY = "acos_dna_profile";

const DEFAULT_PROFILE: UserDNAProfile = {
  id: "user-default",
  preferences: {
    theme: "system",
    typography: "sans",
    density: "comfortable",
    animationSpeed: "normal",
    colorPalette: "slate",
  },
  cognitiveStyle: {
    verbosity: "balanced",
    tone: "professional",
    decisionMaking: "data-driven",
    language: "ja",
  },
  workflowHabits: {
    mostUsedCapabilities: [],
    typicalWorkingHours: "09:00-18:00",
    frequentIntegrations: [],
  },
  learningWeights: {},
  version: 1,
  lastUpdated: Date.now(),
};

export class DNARepository {
  public async loadProfile(): Promise<UserDNAProfile> {
    if (typeof window === "undefined") return DEFAULT_PROFILE;
    try {
      const data = localStorage.getItem(DNA_STORAGE_KEY);
      if (data) {
        return { ...DEFAULT_PROFILE, ...JSON.parse(data) };
      }
    } catch (e) {
      console.error("[DNARepository] Failed to load profile:", e);
    }
    return DEFAULT_PROFILE;
  }

  public async saveProfile(profile: UserDNAProfile): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(DNA_STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error("[DNARepository] Failed to save profile:", e);
    }
  }
}

export const dnaRepository = new DNARepository();
