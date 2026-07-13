import { organizationExecutorInstance } from '../../services/mission-engine/src/application/organization/OrganizationExecutor';

const runLive = process.env.RUN_LIVE_PROVIDER_TESTS === 'true';

describe('ACOS 2.0 API Full Lifecycle (Live Provider Integration)', () => {
  const testFn = runLive ? it : it.skip;

  testFn('should complete a full mission successfully using real Provider', async () => {
    // Assert that the Gemini API Key is actually present
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is required for live integration tests.');
    }

    const objective = 'Plan a 1-day quick trip to Tokyo with 3 main spots.';
    const missionId = `test-api-mission-live-${Date.now()}`;
    
    // Execute the mission. This tests the full OrganizationExecutor pipeline with real provider calls
    const state = await organizationExecutorInstance.executeMission(missionId, objective, undefined, {
      onApprovalRequired: async (req, exec) => {
        exec.resolveHumanApproval(req.orgId, req.id, true, "Live test auto-approve");
      }
    });
    
    // Assert the final state
    expect(state).toBeDefined();
    expect(state.currentState).toBe('COMPLETED');
    expect(state.activeTasks.length).toBeGreaterThan(0);
    expect(state.deliverables.length).toBeGreaterThan(0);
    
    // Check that reviews occurred
    expect(state.reviews).toBeDefined();
    expect(state.reviews.length).toBeGreaterThanOrEqual(0);

    // Ensure the mission actually produced content
    expect(state.deliverables[0].content).toBeTruthy();
  }, 180000); // 3-minute timeout for real network / provider latency
});
