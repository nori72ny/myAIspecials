import { AIModel, AICapability, RoutingRequest, RoutingResponse } from './types';
import aiModelsData from './data/ai-models.json';

export class RoutingEngine {
  private models: AIModel[];

  constructor(customModels?: AIModel[]) {
    this.models = customModels || (aiModelsData as AIModel[]);
  }

  /**
   * 1. 入力内容解析 & 2. 必要能力抽出
   */
  public extractCapabilities(input: string): AICapability[] {
    const text = input.toLowerCase();
    const capabilities = new Set<AICapability>();

    if (text.match(/(考え|推論|理由|なぜ|理由を教えて|思考)/)) capabilities.add("Reasoning");
    if (text.match(/(調べ|検索|最新|ニュース|リサーチ)/)) capabilities.add("Research");
    if (text.match(/(文章|書いて|作成して|生成|ブログ|記事)/)) capabilities.add("Text Generation");
    if (text.match(/(画像|絵|イラスト|写真)/)) capabilities.add("Image Generation");
    if (text.match(/(コード|プログラム|実装|バグ|エラー|スクリプト|プログラミング)/)) capabilities.add("Code");
    if (text.match(/(計算|数学|数式|統計|確率)/)) capabilities.add("Math");
    if (text.match(/(法律|規約|契約|法務|リーガル)/)) capabilities.add("Law");
    if (text.match(/(医療|病気|症状|健康|診断)/)) capabilities.add("Medical");
    if (text.match(/(マーケティング|広告|宣伝|ペルソナ|ターゲット|市場)/)) capabilities.add("Marketing");
    if (text.match(/(資料|スライド|プレゼン|パワポ)/)) capabilities.add("Presentation");

    // デフォルトはテキスト生成と推論とする
    if (capabilities.size === 0) {
      capabilities.add("Text Generation");
      capabilities.add("Reasoning");
    }

    return Array.from(capabilities);
  }

  /**
   * 3. 各AIの能力テーブルと比較
   * 4. 最適AIを選択
   * 5. 必要なら複数AI選択
   * 6. 統合担当AIを選択
   */
  public route(request: RoutingRequest): RoutingResponse {
    const capabilities = this.extractCapabilities(request.input);
    const availableModels = this.models.filter(m => m.available);

    if (availableModels.length === 0) {
      throw new Error("No available AI models.");
    }

    // 各能力に対する最適なAIをマッピング
    const capabilityToModel = new Map<AICapability, AIModel>();

    capabilities.forEach(cap => {
      let bestModel = this.findBestModelForCapability(cap, availableModels, request.priority);
      if (bestModel) {
        capabilityToModel.set(cap, bestModel);
      }
    });

    const uniqueSelectedModels = Array.from(new Set(capabilityToModel.values()));

    if (uniqueSelectedModels.length === 0) {
      // 見つからなかった場合は汎用的なものを選択
      const fallbackModel = this.findBestModelForCapability("Reasoning", availableModels, request.priority) 
                         || availableModels[0];
      return {
        primaryAI: fallbackModel,
        secondaryAIs: [],
        extractedCapabilities: capabilities,
        needsIntegration: false
      };
    }

    if (uniqueSelectedModels.length === 1) {
      return {
        primaryAI: uniqueSelectedModels[0],
        secondaryAIs: [],
        extractedCapabilities: capabilities,
        needsIntegration: false
      };
    }

    // 複数AIが必要な場合
    // primaryAIは最も高品質なものか、推論・文章生成に長けたものを選ぶ
    const integrationModel = this.selectIntegrationModel(availableModels, request.priority);
    
    // primaryAIを一つ選び、残りをsecondaryとする
    const primaryAI = uniqueSelectedModels[0];
    const secondaryAIs = uniqueSelectedModels.slice(1);

    return {
      primaryAI,
      secondaryAIs,
      integrationAI: integrationModel,
      extractedCapabilities: capabilities,
      needsIntegration: true
    };
  }

  private findBestModelForCapability(
    capability: AICapability, 
    models: AIModel[], 
    priority: "speed" | "cost" | "quality" = "quality"
  ): AIModel | null {
    const capableModels = models.filter(m => m.specialties.includes(capability));
    
    if (capableModels.length === 0) return null;

    return capableModels.sort((a, b) => {
      // 失敗率を加味したスコア計算
      const scoreA = this.calculateScore(a, priority);
      const scoreB = this.calculateScore(b, priority);
      return scoreB - scoreA; // 降順
    })[0];
  }

  private selectIntegrationModel(models: AIModel[], priority: "speed" | "cost" | "quality" = "quality"): AIModel {
    // 統合には推論とテキスト生成能力が高いAIが適している
    const integrationCandidates = models.filter(m => 
      m.specialties.includes("Reasoning") && m.specialties.includes("Text Generation")
    );
    
    const targetModels = integrationCandidates.length > 0 ? integrationCandidates : models;

    return targetModels.sort((a, b) => {
      const scoreA = this.calculateScore(a, "quality"); // 統合は常に品質重視
      const scoreB = this.calculateScore(b, "quality");
      return scoreB - scoreA;
    })[0];
  }

  private calculateScore(model: AIModel, priority: "speed" | "cost" | "quality"): number {
    let baseScore = 0;
    
    switch (priority) {
      case "speed":
        baseScore = model.speed * 2 + model.quality;
        break;
      case "cost":
        // コストは低いほど良いので反転(10 - cost)
        baseScore = (10 - model.cost) * 2 + model.quality;
        break;
      case "quality":
        baseScore = model.quality * 2 + model.speed;
        break;
    }

    // 失敗率のペナルティ (0.01 = 1%, 大きな影響を与えない程度に減点)
    const failurePenalty = model.failureRate * 10;
    
    return baseScore - failurePenalty;
  }
}
