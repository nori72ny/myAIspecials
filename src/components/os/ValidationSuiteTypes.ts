// ValidationSuiteTypes.ts - Sprint 21: World Class Validation Program Types

export type DifficultyLevel = "Easy" | "Normal" | "Hard" | "Expert" | "Impossible";

export interface GoldenAnswer {
  idealAnswer: string;
  minQuality: string;
  ngExample: string;
  criteria: string[];
}

export interface MissionBenchmark {
  id: string;
  category: string;
  difficulty: DifficultyLevel;
  input: string;
  golden: GoldenAnswer;
}

export interface EvaluationScores {
  fact: number;
  goal: number;
  ux: number;
  speed: number;
  completeness: number;
  readability: number;
  structure: number;
  evidence: number;
  risk: number;
  creativity: number;
  actionability: number;
  reasoning: number;
}

export interface EvaluationResult {
  missionId: string;
  status: "Pass" | "Fail";
  scores: EvaluationScores;
  averageScore: number;
  evaluatedAt: string;
  commentary: string;
}

export interface WorldBenchmarkStats {
  aiName: string;
  winRate: number; // Percentage
  latencyMs: number;
  qualityScore: number;
  reliability: number;
}

export interface WeaknessAnalysis {
  id: string;
  analyzedAt: string;
  category: string;
  failCount: number;
  rootCause: string;
  improvementPlan: string;
  remediationStatus: "Open" | "In Progress" | "Resolved";
}

export interface DailyEvolutionLog {
  date: string;
  successRate: number;
  overallQuality: number;
  factScore: number;
  uxScore: number;
  speedScore: number;
  improvementRate: number; // compared to previous day
}

export interface QualityWeeklyReport {
  weekId: string;
  generatedAt: string;
  improvements: string[];
  risks: string[];
  debts: string[];
  qualitySummary: string;
  averageSpeedMs: number;
  satisfactionRate: number;
}
