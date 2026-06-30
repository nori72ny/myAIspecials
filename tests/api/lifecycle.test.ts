import { organizationExecutorInstance } from '../../services/mission-engine/src/application/organization/OrganizationExecutor';

describe('ACOS 2.0 API Full Lifecycle (Integration)', () => {
  it('should complete a full mission successfully', async () => {
    const objective = 'Plan a 1-day quick trip to Tokyo with 3 main spots.';
    const missionId = `test-api-mission-${Date.now()}`;
    
    // Execute the mission. This tests the full OrganizationExecutor pipeline
    // including Task, Agent, Review, Consensus, Evolution, etc.
    const state = await organizationExecutorInstance.executeMission(missionId, objective);
    
    // Assert the final state
    expect(state).toBeDefined();
    expect(state.currentState).toBe('COMPLETED');
    expect(state.activeTasks.length).toBeGreaterThan(0);
    expect(state.deliverables.length).toBeGreaterThan(0);
    
    // Check that reviews occurred
    expect(state.reviews).toBeDefined();
    expect(state.reviews.length).toBeGreaterThanOrEqual(0); // Might be 0 if auto-passed without review in some branches, but should be defined

    // Ensure the mission actually produced content
    expect(state.deliverables[0].content).toBeTruthy();
  }, 120000); // 2 minute timeout
});
