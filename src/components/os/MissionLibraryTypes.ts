// MissionLibraryTypes.ts - Sprint 21 Program 1: Mission Library Types

export interface Mission {
  id: string;
  title: string;
  category: string;
  objective: string; // 目的
  goal: string; // ゴール
  requiredAI: string; // 必要AI
  requiredAgent: string; // 必要Agent
  factImportance: "Low" | "Medium" | "High" | "Critical"; // Fact重要度
  deliverableType: string; // 成果物種類
  evaluationCriteria: string[]; // 評価基準
  idealAnswer: string; // 理想回答
  ngAnswer: string; // NG回答
  improvementPoints: string[]; // 改善ポイント
  tags: string[]; // タグ
  isFavorite: boolean; // お気に入りフラグ
  runCount: number; // 履歴・実行数
}

export interface SearchFilters {
  query: string;
  category: string;
  tag: string;
  onlyFavorites: boolean;
  factImportance: string;
}
