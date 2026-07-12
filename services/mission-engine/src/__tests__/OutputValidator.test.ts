import { describe, it, expect } from "vitest";
import { OutputValidatorService } from "../application/agent/governance/OutputValidatorService";
import { OrganizationState, OrgExecutionState } from "../application/organization/OrganizationTypes";

describe("=== OutputValidatorService Unit Tests ===", () => {
  const mockBaseState = (): OrganizationState => ({
    orgId: "org-1",
    missionId: "ms-1",
    currentState: OrgExecutionState.COMPLETED,
    activeTasks: [
      {
        id: "tsk-impl",
        missionId: "ms-1",
        title: "Technical Coding Implementation",
        description: "Implement critical algorithms",
        requiredCapability: "Coding",
        priority: 7,
        department: "Engineering" as any,
        status: "Completed" as any,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "tsk-doc",
        missionId: "ms-1",
        title: "Content Development",
        description: "Create documentation",
        requiredCapability: "Writing",
        priority: 6,
        department: "Content" as any,
        status: "Completed" as any,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    deliverables: [
      {
        id: "del-impl",
        taskId: "tsk-impl",
        content: "const x = 42;\nfunction run() { return x; }\n// References: https://github.com/acos-project\n// Evidence: checked against standard benchmark.",
        authorAgentId: "worker-1",
        version: 1,
        createdAt: new Date()
      },
      {
        id: "del-doc",
        taskId: "tsk-doc",
        content: "This is a detailed technical documentation outlining everything [1].\nVerification evidence is documented herein.",
        authorAgentId: "worker-2",
        version: 1,
        createdAt: new Date()
      }
    ],
    reviews: [
      {
        id: "rev-1",
        deliverableId: "del-impl",
        reviewerAgentId: "mgr-1",
        score: 95,
        feedback: "Matches and validates criteria.",
        status: "APPROVED" as any,
        createdAt: new Date()
      }
    ],
    escalations: [],
    consensusRounds: [],
    departments: {} as any,
    roleMapping: {},
    updatedAt: new Date()
  });

  it("should pass happy path validation when all criteria are met", () => {
    const state = mockBaseState();
    const result = OutputValidatorService.validate("Build dynamic algorithm", state);

    expect(result.isValid).toBe(true);
    expect(result.details.artifactVerification.passed).toBe(true);
    expect(result.details.domainMatchCheck.passed).toBe(true);
    expect(result.details.evidenceVerification.passed).toBe(true);
    expect(result.details.citationVerification.passed).toBe(true);
    expect(result.failureReason).toBeUndefined();
  });

  it("should fail Artifact Verification when deliverables are missing", () => {
    const state = mockBaseState();
    state.deliverables = [];

    const result = OutputValidatorService.validate("Build dynamic algorithm", state);
    expect(result.isValid).toBe(false);
    expect(result.details.artifactVerification.passed).toBe(false);
    expect(result.details.artifactVerification.message).toContain("成果物が一件も生成されていません");
  });

  it("should fail Artifact Verification when a placeholder is detected", () => {
    const state = mockBaseState();
    state.deliverables[0].content += "\nTODO: fix this before commit";

    const result = OutputValidatorService.validate("Build dynamic algorithm", state);
    expect(result.isValid).toBe(false);
    expect(result.details.artifactVerification.passed).toBe(false);
    expect(result.details.artifactVerification.message).toContain("未完成のプレースホルダー");
  });

  it("should fail Domain Match Check when a coding task contains no code syntax", () => {
    const state = mockBaseState();
    // Replaces programming concepts with simple plain English
    state.deliverables[0].content = "This is a plain descriptive text with no coding items.";

    const result = OutputValidatorService.validate("Build dynamic algorithm", state);
    expect(result.isValid).toBe(false);
    expect(result.details.domainMatchCheck.passed).toBe(false);
    expect(result.details.domainMatchCheck.message).toContain("成果物にコード構文（const, function等）が検出されませんでした");
  });

  it("should fail Evidence Verification when there are no approvals and no evidence keywords", () => {
    const state = mockBaseState();
    state.reviews = [];
    state.deliverables[0].content = "const x = 42;\nfunction run() { return x; }"; // removed evidence and refs
    state.deliverables[1].content = "This is a detailed technical documentation outlining everything."; // removed bracketed citation and evidence

    const result = OutputValidatorService.validate("Build dynamic algorithm", state);
    expect(result.isValid).toBe(false);
    expect(result.details.evidenceVerification.passed).toBe(false);
    expect(result.details.evidenceVerification.message).toContain("エビデンス、または承認の証明が不足しています");
  });

  it("should fail Citation Verification when there are only prohibited mock URLs and no bracketed citations", () => {
    const state = mockBaseState();
    state.deliverables[0].content = "const x = 42;\nfunction run() { return x; }\n// Reference: https://example.com/mock-doc\n// Evidence: checked."; // prohibited URL
    state.deliverables[1].content = "This is a detailed technical documentation outlining everything.\nVerification evidence is documented herein."; // no bracketed citation

    const result = OutputValidatorService.validate("Build dynamic algorithm", state);
    expect(result.isValid).toBe(false);
    expect(result.details.citationVerification.passed).toBe(false);
    expect(result.details.citationVerification.message).toContain("引用または文献の参照が検出されませんでした");
  });
});
