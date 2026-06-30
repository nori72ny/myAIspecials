import { RiskMission } from "./StrategicTypes";
import { OrganizationState } from "../organization/OrganizationTypes";

export class RiskIntelligenceEngine {
  public generateRiskMissions(state: OrganizationState): RiskMission[] {
    const risks: RiskMission[] = [];
    if (state.activeTasks && state.activeTasks.length > 5) {
      risks.push({
        id: `rm-${Date.now()}`,
        title: "High Workload Mitigation",
        description: "Current active tasks exceed safe threshold. Reallocate resources.",
        severity: "HIGH",
        targetArea: "Engineering"
      });
    }
    if (state.escalations && state.escalations.length > 2) {
      risks.push({
        id: `rm-${Date.now()+1}`,
        title: "Process Escalation Review",
        description: "Repeated escalations detected. Process bottlenecks likely.",
        severity: "MEDIUM",
        targetArea: "Management"
      });
    }
    if (risks.length === 0) {
      risks.push({
        id: `rm-default`,
        title: "Routine Audit",
        description: "No critical risks detected. Perform routine security and code quality audits.",
        severity: "LOW",
        targetArea: "All"
      });
    }
    return risks;
  }
}
