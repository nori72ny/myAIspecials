import type { OriginAgentWorkPlan } from "./OriginAgentWorkPlan";

export interface OriginServiceRegistration {
  id: string;
  label: string;
  adapterId: string;
  capabilities: readonly string[];
  available: boolean;
  freeOnly: true;
  maxEstimatedCostUsd: 0;
  automaticFallback: false;
  qualityEvidence: {
    testIds: readonly string[];
    validatedAt: string;
  };
}

export interface OriginWorkStepAssignment {
  stepId: string;
  requiredCapability: string;
  serviceId?: string;
  serviceLabel?: string;
  status: "assigned" | "partial" | "unavailable";
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
  qualityEvidence: {
    testIds: [
      "origin-chat-router",
      "origin-answer-envelope",
      "origin-product-experience-contract",
    ],
    validatedAt: "2026-07-24",
  },
};

function validateService(registration: OriginServiceRegistration): OriginServiceRegistrationResult {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(registration.id)) {
    return { ok: false, code: "INVALID_SERVICE_ID" };
  }
  if (!registration.label.trim()) {
    return { ok: false, code: "INVALID_SERVICE_LABEL" };
  }
  if (!registration.adapterId.trim()) {
    return { ok: false, code: "INVALID_ADAPTER" };
  }
  const capabilities = registration.capabilities.map((capability) => capability.trim());
  if (
    capabilities.length === 0
    || capabilities.some((capability) => !capability)
    || new Set(capabilities).size !== capabilities.length
  ) {
    return { ok: false, code: "INVALID_CAPABILITIES" };
  }
  if (
    registration.freeOnly !== true
    || registration.maxEstimatedCostUsd !== 0
    || registration.automaticFallback !== false
  ) {
    return { ok: false, code: "INVALID_COST_POLICY" };
  }
  if (
    registration.available
    && (
      registration.qualityEvidence.testIds.length === 0
      || !registration.qualityEvidence.validatedAt.trim()
    )
  ) {
    return { ok: false, code: "MISSING_QUALITY_EVIDENCE" };
  }
  return { ok: true };
}

export class OriginServiceRegistry {
  private readonly services = new Map<string, OriginServiceRegistration>();

  constructor(initial: readonly OriginServiceRegistration[] = [ORIGIN_TEXT_RUNTIME_SERVICE]) {
    for (const registration of initial) {
      const result = this.register(registration);
      if (!result.ok) throw new Error(result.code);
    }
  }

  register(registration: OriginServiceRegistration): OriginServiceRegistrationResult {
    const result = validateService(registration);
    if (!result.ok) return result;
    this.services.set(registration.id, Object.freeze({
      ...registration,
      capabilities: Object.freeze([...registration.capabilities]),
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

export function resolveOriginAgentWorkPlan(
  plan: OriginAgentWorkPlan,
  registry: OriginServiceRegistry = new OriginServiceRegistry(),
): OriginResolvedWorkPlan {
  const assignments = plan.steps.map((step): OriginWorkStepAssignment => {
    if (step.availability !== "available") {
      return {
        stepId: step.id,
        requiredCapability: step.requiredCapability,
        status: step.availability === "unavailable" ? "unavailable" : "partial",
      };
    }

    const service = registry.findAvailable(step.requiredCapability);
    return service
      ? {
          stepId: step.id,
          requiredCapability: step.requiredCapability,
          serviceId: service.id,
          serviceLabel: service.label,
          status: "assigned",
        }
      : {
          stepId: step.id,
          requiredCapability: step.requiredCapability,
          status: "unavailable",
        };
  });
  const unavailableCapabilities = assignments
    .filter((assignment) => assignment.status === "unavailable")
    .map((assignment) => assignment.requiredCapability);

  return {
    assignments,
    allAvailableStepsAssigned: assignments.every(
      (assignment) => assignment.status !== "unavailable",
    ),
    unavailableCapabilities: [...new Set(unavailableCapabilities)],
  };
}

export function originServiceAssignmentInstruction(resolved: OriginResolvedWorkPlan): string {
  const assignments = resolved.assignments.map((assignment, index) =>
    `${index + 1}. ${assignment.stepId} | ${assignment.requiredCapability} | ${assignment.status}`
    + (assignment.serviceId ? ` | ${assignment.serviceId}` : ""));

  return [
    "Application service assignments (routing evidence; not proof of completed execution):",
    ...assignments,
    "- Only assigned services may be treated as available.",
    "- A partial or unavailable assignment must never be described as executed.",
    "- Do not substitute another service automatically when an assignment is unavailable.",
  ].join("\n");
}
