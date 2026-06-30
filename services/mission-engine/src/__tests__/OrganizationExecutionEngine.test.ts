import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistryService } from "../application/agent/governance/AgentRegistryService";
import { AgentLifecycleState, AgentCapability } from "../application/agent/governance/AgentGovernanceTypes";
import { OrganizationExecutor } from "../application/organization/OrganizationExecutor";
import { WorkDistributionEngine } from "../application/organization/WorkDistributionEngine";
import { DelegationEngine } from "../application/organization/DelegationEngine";
import { ReviewEngine } from "../application/organization/ReviewEngine";
import { ConsensusEngine } from "../application/organization/ConsensusEngine";
import { EscalationEngine } from "../application/organization/EscalationEngine";
import { OrganizationMetricsTracker } from "../application/organization/OrganizationMetricsTracker";
import { 
  OrgExecutionState, 
  OrgRole, 
  OrgDepartment, 
  Task, 
  Deliverable, 
  Review, 
  ReviewStatus 
} from "../application/organization/OrganizationTypes";

describe("ACOS 2.0 Organization Execution Engine Unit & Integration Tests", () => {
  let registry: AgentRegistryService;
  let executor: OrganizationExecutor;
  let distribution: WorkDistributionEngine;
  let delegation: DelegationEngine;
  let reviews: ReviewEngine;
  let consensus: ConsensusEngine;
  let escalation: EscalationEngine;
  let metricsTracker: OrganizationMetricsTracker;

  beforeEach(() => {
    registry = AgentRegistryService.getInstance();
    registry.clear(); // Reset to seed agents: agent-1, agent-2, agent-default
    executor = new OrganizationExecutor();
    distribution = new WorkDistributionEngine(registry);
    delegation = new DelegationEngine();
    reviews = new ReviewEngine();
    consensus = new ConsensusEngine();
    escalation = new EscalationEngine();
    metricsTracker = new OrganizationMetricsTracker();
  });

  describe("1. Work Distribution Engine", () => {
    it("should find the optimal agent with matching capabilities and low load", () => {
      const task: Task = {
        id: "task-test-1",
        missionId: "m-1",
        title: "Test Task",
        description: "Test description",
        requiredCapability: "Planning",
        priority: 5,
        department: OrgDepartment.Engineering,
        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Candidate is agent-1 (has Planning capability)
      const optimal = distribution.findOptimalAgent(task, ["agent-1", "agent-2"]);
      expect(optimal).toBeDefined();
      expect(optimal?.id).toBe("agent-1");
      expect(optimal?.load).toBe(1); // Load incremented by engine
    });

    it("should return undefined if no matching capable agent exists", () => {
      const task: Task = {
        id: "task-test-2",
        missionId: "m-1",
        title: "Test Task 2",
        description: "Requires Vision",
        requiredCapability: "Vision", // agent-1 does not have Vision, only agent-2 has
        priority: 5,
        department: OrgDepartment.Engineering,
        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const optimal = distribution.findOptimalAgent(task, ["agent-1"]);
      // Since agent-1 lacks Vision capability, it shouldn't be matched
      expect(optimal).toBeUndefined();
    });
  });

  describe("2. Delegation Engine", () => {
    it("should trigger delegation if delegator is overloaded", () => {
      const task: Task = {
        id: "task-del-1",
        missionId: "m-1",
        title: "Task",
        description: "desc",
        requiredCapability: "Coding",
        priority: 5,
        department: OrgDepartment.Engineering,
        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const shouldDelegate = delegation.shouldDelegate(task, OrgRole.MANAGER, 2, ["Planning"]);
      expect(shouldDelegate).toBe(true);
    });

    it("should trigger delegation if there is a capability mismatch", () => {
      const task: Task = {
        id: "task-del-2",
        missionId: "m-1",
        title: "Task 2",
        description: "desc",
        requiredCapability: "Coding",
        priority: 5,
        department: OrgDepartment.Engineering,
        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Manager only has Planning, task needs Coding
      const shouldDelegate = delegation.shouldDelegate(task, OrgRole.MANAGER, 0, ["Planning"]);
      expect(shouldDelegate).toBe(true);
    });

    it("should resolve correct target role in hierarchy", () => {
      expect(delegation.getDelegationTargetRole(OrgRole.CEO)).toBe(OrgRole.BOARD);
      expect(delegation.getDelegationTargetRole(OrgRole.BOARD)).toBe(OrgRole.CHIEF);
      expect(delegation.getDelegationTargetRole(OrgRole.CHIEF)).toBe(OrgRole.DIRECTOR);
      expect(delegation.getDelegationTargetRole(OrgRole.DIRECTOR)).toBe(OrgRole.MANAGER);
      expect(delegation.getDelegationTargetRole(OrgRole.MANAGER)).toBe(OrgRole.WORKER);
    });
  });

  describe("3. Review Engine", () => {
    it("should select correct reviewer count depending on task priority", () => {
      expect(reviews.getRequiredReviewerCount(1)).toBe(2);
      expect(reviews.getRequiredReviewerCount(5)).toBe(3);
      expect(reviews.getRequiredReviewerCount(8)).toBe(4);
      expect(reviews.getRequiredReviewerCount(10)).toBe(5);
    });

    it("should select reviewers excluding the deliverable author", () => {
      const deliverable: Deliverable = {
        id: "del-1",
        taskId: "task-1",
        content: "some content",
        authorAgentId: "worker-1",
        version: 1,
        createdAt: new Date()
      };

      const selected = reviews.selectReviewers(
        deliverable,
        ["worker-1", "worker-2", "manager-1", "director-1"],
        { "worker-1": OrgRole.WORKER, "worker-2": OrgRole.WORKER, "manager-1": OrgRole.MANAGER, "director-1": OrgRole.DIRECTOR },
        2
      );

      expect(selected).not.toContain("worker-1");
      expect(selected.length).toBe(2);
    });
  });

  describe("4. Consensus Engine", () => {
    it("should resolve split votes with reasonable debate compromise", () => {
      const reviewsList: Review[] = [
        {
          id: "r-1",
          deliverableId: "del-1",
          reviewerAgentId: "mgr-1",
          score: 85,
          feedback: "Great structure",
          status: ReviewStatus.APPROVED,
          createdAt: new Date()
        },
        {
          id: "r-2",
          deliverableId: "del-1",
          reviewerAgentId: "dir-1",
          score: 60,
          feedback: "Requires critical security fixes",
          status: ReviewStatus.REJECTED,
          createdAt: new Date()
        }
      ];

      const round = consensus.resolveConflict(reviewsList, "del-1", { "mgr-1": "MANAGER", "dir-1": "DIRECTOR" });
      expect(round.finalVerdict).toBe(ReviewStatus.REJECTED); // Compromise rejects on lower score
      expect(round.rational).toContain("Consensus Achieved: REJECTED with conditions");
    });
  });

  describe("5. Escalation Engine", () => {
    it("should elevate task upwards in the corporate ladder", () => {
      const task: Task = {
        id: "task-esc-1",
        missionId: "m-1",
        title: "Blocked Task",
        description: "blocked desc",
        requiredCapability: "Coding",
        priority: 8,
        department: OrgDepartment.Engineering,
        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const record = escalation.triggerEscalation(
        "org-1",
        task,
        "mgr-agent",
        OrgRole.MANAGER,
        "Unresolved technical blocker"
      );

      expect(record.toRole).toBe(OrgRole.DIRECTOR);
      expect(record.resolved).toBe(false);
    });
  });

  describe("6. Organization Executor (End-to-End Flow)", () => {
    it("should execute full automated corporate mission pipeline successfully", async () => {
      const orgState = executor.createOrganization("m-e2e", "Global Dev Org");
      expect(orgState.currentState).toBe(OrgExecutionState.MISSION_RECEIVED);

      const finalState = await executor.runExecutionLoop(orgState.orgId, "Build dynamic Web App using React");
      expect(finalState.currentState).toBe(OrgExecutionState.COMPLETED);
      expect(finalState.deliverables.length).toBeGreaterThan(0);
      expect(finalState.reviews.length).toBeGreaterThan(0);
    });
  });
});
