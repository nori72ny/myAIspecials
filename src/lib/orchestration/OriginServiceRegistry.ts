import type { OriginAgentWorkPlan, OriginAiRole } from "./OriginAgentWorkPlan.js";

export const ORIGIN_AGENT_ARCHITECTURE_DIMENSIONS = [
  "planner",
  "memory",
  "tool-router",
  "computer-use",
  "multi-agent",
  "verification",
  "permission",
  "cost-control",
  "model-routing",
  "persistence",
] as const;

export type OriginAgentArchitectureDimension =
  typeof ORIGIN_AGENT_ARCHITECTURE_DIMENSIONS[number];

export type OriginAgentArchitectureSupport =
  | "application-managed"
  | "service-native"
  | "unavailable";

export interface OriginAgentArchitectureCapability {
  support: OriginAgentArchitectureSupport;
  evidenceIds: readonly string[];
}

export type OriginAgentArchitectureProfile = Readonly<Record<
  OriginAgentArchitectureDimension,
  OriginAgentArchitectureCapability
>>;

export interface OriginServicePermissionPolicy {
  externalActions: "deny" | "require-owner-approval";
}

export interface OriginServiceRegistration {
  id: string;
  label: string;
  adapterId: string;
  capabilities: readonly string[];
  available: boolean;
  freeOnly: true;
  maxEstimatedCostUsd: 0;
  automaticFallback: false;
  permissionPolicy: OriginServicePermissionPolicy;
  architectureProfile: OriginAgentArchitectureProfile;
  qualityEvidence: {
    testIds: readonly string[];
    validatedAt: string;
  };
}

export interface OriginWorkStepAssignment {
  stepId: string;
  aiRole: OriginAiRole;
  requiredCapability: string;
  serviceId?: string;
  serviceLabel?: string;
  status: "assigned" | "partial" | "unavailable";
  architectureProfileComplete?: true;
  externalActionPolicy?: OriginServicePermissionPolicy["externalActions"];
}

export interface OriginResolvedWorkPlan {
  assignments: readonly OriginWorkStepAssignment[];
  allAvailableStepsAssigned: boolean;
  unavailableCapabilities: readonly string[];
}

export type OriginServiceRegistrationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "INVALID_SERVICE_ID"
        | "INVALID_SERVICE_LABEL"
        | "INVALID_ADAPTER"
        | "INVALID_CAPABILITIES"
        | "INVALID_COST_POLICY"
        | "INVALID_ARCHITECTURE_PROFILE"
        | "INVALID_PERMISSION_POLICY"
        | "MISSING_QUALITY_EVIDENCE";
    };

export const ORIGIN_TEXT_RUNTIME_SERVICE: OriginServiceRegistration = {
  id: "origin-text-runtime",
  label: "ORIGIN Text Runtime",
  adapterId: "authoritative-origin-chat",
  capabilities: [
    "goal-understanding",
    "output-design",
    "text-generation",
    "quality-review",
    "result-presentation",
  ],
  available: true,
  freeOnly: true,
  maxEstimatedCostUsd: 0,
  automaticFallback: false,
  permissionPolicy: {
    externalActions: "deny",
  },
  architectureProfile: {
    planner: { support: "application-managed", evidenceIds: ["origin-agent-work-plan"] },
    memory: { support: "application-managed", evidenceIds: ["origin-context-policy"] },
    "tool-router": { support: "application-managed", evidenceIds: ["origin-service-registry"] },
    "computer-use": { support: "unavailable", evidenceIds: ["origin-external-action-deny"] },
    "multi-agent": { support: "unavailable", evidenceIds: ["origin-independent-review-not-run"] },
    verification: { support: "application-managed", evidenceIds: ["origin-review-policy"] },
    permission: { support: "application-managed", evidenceIds: ["origin-service-registry"] },
    "cost-control": { support: "application-managed", evidenceIds: ["origin-execution-policy"] },
    "model-routing": { support: "application-managed", evidenceIds: ["origin-free-model-catalog"] },
    persistence: { support: "application-managed", evidenceIds: ["origin-chat-history-contract"] },
  },
  qualityEvidence: {
    testIds: [
      "origin-chat-router",
      "origin-answer-envelope",
      "origin-product-experience-contract",
    ],
    validatedAt: "2026-07-24",
  },
};

function hasCompleteArchitectureProfile(
  profile: OriginAgentArchitectureProfile,
): boolean {
  const keys = Object.keys(profile).sort();
  const required = [...ORIGIN_AGENT_ARCHITECTURE_DIMENSIONS].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    return false;
  }

  return ORIGIN_AGENT_ARCHITECTURE_DIMENSIONS.every((dimension) => {
    const capability = profile[dimension];
    return capability
      && ["application-managed", "service-native", "unavailable"].includes(capability.support)
      && capability.evidenceIds.length > 0
      && capability.evidenceIds.every((evidenceId) => evidenceId.trim().length > 0);
  });
}

function validateService(registration: OriginServiceRegistration): OriginServiceRegistrationResult {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(registration.id)) return { ok: false, code: "INVALID_SERVICE_ID" };
  if (!registration.label.trim()) return { ok: false, code: "INVALID_SERVICE_LABEL" };
  if (!registration.adapterId.trim()) return { ok: false, code: "INVALID_ADAPTER" };
  const capabilities = registration.capabilities.map((capability) => capability.trim());
  if (capabilities.length === 0 || capabilities.some((capability) => !capability) || new Set(capabilities).size !== capabilities.length) {
    return { ok: false, code: "INVALID_CAPABILITIES" };
  }
  if (registration.freeOnly !== true || registration.maxEstimatedCostUsd !== 0 || registration.automaticFallback !== false) {
    return { ok: false, code: "INVALID_COST_POLICY" };
  }
  if (!hasCompleteArchitectureProfile(registration.architectureProfile)) {
    return { ok: false, code: "INVALID_ARCHITECTURE_PROFILE" };
  }
  if (
    registration.capabilities.includes("external-action")
    && registration.permissionPolicy.externalActions !== "require-owner-approval"
  ) {
    return { ok: false, code: "INVALID_PERMISSION_POLICY" };
  }
  if (registration.available && (registration.qualityEvidence.testIds.length === 0 || !registration.qualityEvidence.validatedAt.trim())) {
    return { ok: false, code: "MISSING_QUALITY_EVIDENCE" };
  }
  return { ok: true };
}

export class OriginServiceRegistry {
  private readonly services = new Map<string, OriginServiceRegistration>();

  constructor(initial: readonly OriginServiceRegistration[] = [ORIGIN_TEXT_RUNTIME_SERVICE]) {
    for (const registration of initial) {
      const result = this.register(registration);
      if (result.ok === false) throw new Error(result.code);
    }
  }

  register(registration: OriginServiceRegistration): OriginServiceRegistrationResult {
    const result = validateService(registration);
    if (!result.ok) return result;
    this.services.set(registration.id, Object.freeze({
      ...registration,
      capabilities: Object.freeze([...registration.capabilities]),
      permissionPolicy: Object.freeze({ ...registration.permissionPolicy }),
      architectureProfile: Object.freeze(Object.fromEntries(
        ORIGIN_AGENT_ARCHITECTURE_DIMENSIONS.map((dimension) => [
          dimension,
          Object.freeze({
            ...registration.architectureProfile[dimension],
            evidenceIds: Object.freeze([
              ...registration.architectureProfile[dimension].evidenceIds,
            ]),
          }),
        ]),
      )) as OriginAgentArchitectureProfile,
      qualityEvidence: Object.freeze({
        ...registration.qualityEvidence,
        testIds: Object.freeze([...registration.qualityEvidence.testIds]),
      }),
    }));
    return { ok: true };
  }

  findAvailable(capability: string): OriginServiceRegistration | undefined {
    return [...this.services.values()]
      .filter((service) => service.available && service.capabilities.includes(capability))
      .sort((left, right) => left.id.localeCompare(right.id))[0];
  }
}

export function resolveOriginAgentWorkPlan(plan: OriginAgentWorkPlan, registry: OriginServiceRegistry = new OriginServiceRegistry()): OriginResolvedWorkPlan {
  const assignments = plan.steps.map((step): OriginWorkStepAssignment => {
    if (step.availability !== "available") {
      return {
        stepId: step.id,
        aiRole: step.aiRole,
        requiredCapability: step.requiredCapability,
        status: step.availability === "unavailable" ? "unavailable" : "partial",
      };
    }

    const service = registry.findAvailable(step.requiredCapability);
    return service
      ? {
          stepId: step.id,
          aiRole: step.aiRole,
          requiredCapability: step.requiredCapability,
          serviceId: service.id,
          serviceLabel: service.label,
          status: "assigned",
          architectureProfileComplete: true,
          externalActionPolicy: service.permissionPolicy.externalActions,
        }
      : {
          stepId: step.id,
          aiRole: step.aiRole,
          requiredCapability: step.requiredCapability,
          status: "unavailable",
        };
  });
  const unavailableCapabilities = assignments
    .filter((assignment) => assignment.status === "unavailable")
    .map((assignment) => assignment.requiredCapability);

  return {
    assignments,
    allAvailableStepsAssigned: assignments.every((assignment) => assignment.status !== "unavailable"),
    unavailableCapabilities: [...new Set(unavailableCapabilities)],
  };
}

export function originServiceAssignmentInstruction(resolved: OriginResolvedWorkPlan): string {
  const assignments = resolved.assignments.map((assignment, index) =>
    `${index + 1}. ${assignment.aiRole} | ${assignment.stepId} | ${assignment.requiredCapability} | ${assignment.status}`
    + (assignment.serviceId ? ` | ${assignment.serviceId}` : ""));

  return [
    "Application service assignments (routing evidence; not proof of completed execution):",
    ...assignments,
    "- Only assigned services may be treated as available.",
    "- Every assigned service passed the complete Planner, Memory, Tool Router, Computer Use, Multi-Agent, Verification, Permission, Cost Control, Model Routing, and Persistence profile.",
    "- A partial or unavailable role must never be described as executed.",
    "- Do not substitute another service automatically when an assignment is unavailable.",
    "- Do not substitute another model automatically; a new model must pass the free-only, quality-evidence, capability, architecture, and permission checks first.",
  ].join("\n");
}
