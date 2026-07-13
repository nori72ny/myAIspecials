import { organizationExecutorInstance } from '../../services/mission-engine/src/application/organization/OrganizationExecutor';
import { ILLMClient } from '../../services/mission-engine/src/infrastructure/ai/ILLMClient';

// Deterministic Provider Test Double (Mock Client)
class DeterministicLLMClient implements ILLMClient {
  async generateText(prompt: string, systemPrompt?: string, model?: string): Promise<string> {
    const lowerPrompt = prompt.toLowerCase();
    
    // 1. Review feedback (strict Corporate Manager MGR-ENG-AGENT)
    if (lowerPrompt.includes('review the following deliverable') || lowerPrompt.includes('strict corporate manager')) {
      return JSON.stringify({
        score: 95,
        feedback: "【決定論的テスト】成果物はすべての要件を完璧に満たしています。検証が正常に完了しました。"
      });
    }

    // 2. Board Strategic Directive (Chairman of the Board of IDL 2035)
    if (lowerPrompt.includes('board directive') || (systemPrompt && systemPrompt.includes('Chairman of the Board'))) {
      return "【決定論的テスト】取締役会による戦略指令：東京1日ツアーを計画し、3つの主要スポットを指定せよ。";
    }

    // 3. Chief Strategist Plan (CTO/CMO of IDL 2035)
    if (lowerPrompt.includes('chief strategist plan') || (systemPrompt && (systemPrompt.includes('CTO') || systemPrompt.includes('CMO')))) {
      return "【決定論的テスト】チーフストラテジストによる計画：3つの主要スポットを技術・マーケティング観点で分解する。";
    }

    // 4. Implementation / Code / Report output (Senior Corporate Worker WORKER-ENG-1 of IDL 2035)
    if (lowerPrompt.includes('highly professional and complete output') || (systemPrompt && systemPrompt.includes('WORKER-ENG-1'))) {
      return "【決定論的テスト】1日東京クイックツアー計画書。1: 浅草寺, 2: 明治神宮, 3: 東京タワー。すべての移動経路と時間配分は検証済み。";
    }

    // 5. Documentation / Strategy Brief (Senior Copywriter WORKER-CON-1 of IDL 2035)
    if (lowerPrompt.includes('professional documentation') || (systemPrompt && systemPrompt.includes('WORKER-CON-1'))) {
      return "# 東京クイックツアー戦略ドキュメント\n- **目的**: 1日で東京の主要スポットを制覇する\n- **詳細**: 明治神宮から出発し、浅草で文化を体験、夜は東京タワーで締めくくる。";
    }

    // Fallback response
    return "【決定論的テスト】テスト用デフォルトLLMダミー応答。";
  }
}

describe('ACOS 2.0 API Full Lifecycle (Integration)', () => {
  let originalApiKey: string | undefined;

  beforeAll(() => {
    // Preserve the real API key if any, and set a dummy key to bypass process.env.GEMINI_API_KEY check
    originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'mock-deterministic-key-for-testing';
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it('should complete a full mission successfully without external API dependencies', async () => {
    const objective = 'Plan a 1-day quick trip to Tokyo with 3 main spots.';
    const missionId = `test-api-mission-deterministic-${Date.now()}`;
    const mockClient = new DeterministicLLMClient();
    
    // Execute the mission. We pass the deterministic mock client to avoid real model call latency
    const state = await organizationExecutorInstance.executeMission(missionId, objective, mockClient, {
      onApprovalRequired: async (req, exec) => {
        exec.resolveHumanApproval(req.orgId, req.id, true, "Approved via test double");
      }
    });
    
    // Assert the final state
    expect(state).toBeDefined();
    expect(state.currentState).toBe('COMPLETED');
    expect(state.activeTasks.length).toBeGreaterThan(0);
    expect(state.deliverables.length).toBeGreaterThan(0);
    
    // Check that reviews occurred
    expect(state.reviews).toBeDefined();
    expect(state.reviews.length).toBeGreaterThanOrEqual(2); // Two manager reviews at least

    // Ensure reviews contain mock feedback
    const managerReview = state.reviews.find(r => r.reviewerAgentId === 'MGR-ENG-AGENT');
    expect(managerReview).toBeDefined();
    expect(managerReview?.score).toBe(95);
    expect(managerReview?.feedback).toContain('【決定論的テスト】');

    // Ensure the mission actually produced content
    expect(state.deliverables[0].content).toBeTruthy();
    expect(state.deliverables[0].content).toContain('【決定論的テスト】');
    
    // Assert Dynamic Capacity Routing Logs exist (Explainable Decisions)
    expect(state.selfOptimizationLog).toBeDefined();
    const hasRoutedLog = state.selfOptimizationLog?.some(log => log.includes('[Routed Decision:'));
    expect(hasRoutedLog).toBe(true);

    // Assert Routing Evidence and Quality SLA integration in metadata
    expect(state.deliverables[0].metadata).toBeDefined();
    expect(state.deliverables[0].metadata?.evidence).toContain('【ACOS 2.0 Routing Evidence】');
    expect(state.deliverables[0].metadata?.evidence).toContain('SLA System Score:');
  });

  it('should not transition to COMPLETED before human approval and should transition to AWAITING_HUMAN_APPROVAL', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const objective = 'Plan a 1-day quick trip to Tokyo.';
      const missionId = `test-approval-withhold-${Date.now()}`;
      const mockClient = new DeterministicLLMClient();
      
      // No options/callback provided, so it remains pending
      const state = await organizationExecutorInstance.executeMission(missionId, objective, mockClient);
      
      expect(state.currentState).toBe('AWAITING_HUMAN_APPROVAL');
      expect(state.humanApprovals).toBeDefined();
      expect(state.humanApprovals?.length).toBe(1);
      expect(state.humanApprovals?.[0].status).toBe('AWAITING_HUMAN_APPROVAL');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('should transition to REJECTED if human approval is rejected', async () => {
    const objective = 'Plan a 1-day quick trip to Tokyo.';
    const missionId = `test-approval-reject-${Date.now()}`;
    const mockClient = new DeterministicLLMClient();
    
    const state = await organizationExecutorInstance.executeMission(missionId, objective, mockClient, {
      onApprovalRequired: async (req, exec) => {
        exec.resolveHumanApproval(req.orgId, req.id, false, "Rejected via test double");
      }
    });
    
    expect(state.currentState).toBe('REJECTED');
    expect(state.humanApprovals?.[0].status).toBe('REJECTED');
  });

  it('should reject duplicate approval resolution', async () => {
    const objective = 'Plan a 1-day quick trip to Tokyo.';
    const missionId = `test-approval-duplicate-${Date.now()}`;
    const mockClient = new DeterministicLLMClient();
    
    await expect(
      organizationExecutorInstance.executeMission(missionId, objective, mockClient, {
        onApprovalRequired: async (req, exec) => {
          exec.resolveHumanApproval(req.orgId, req.id, true, "First approval");
          // Second approval on same request should throw
          exec.resolveHumanApproval(req.orgId, req.id, true, "Duplicate approval");
        }
      })
    ).rejects.toThrow(/has already been resolved/);
  });

  it('should return undefined when resolving approval with wrong orgId or wrong requestId', () => {
    const result1 = organizationExecutorInstance.resolveHumanApproval("non-existent-org", "appr-123", true);
    expect(result1).toBeUndefined();

    // Wrong request ID
    const dummyOrgId = `test-wrong-id-org-${Date.now()}`;
    organizationExecutorInstance.createOrganization(dummyOrgId, "Test Org");
    const result2 = organizationExecutorInstance.resolveHumanApproval(dummyOrgId, "appr-wrong", true);
    expect(result2).toBeUndefined();
  });
});
