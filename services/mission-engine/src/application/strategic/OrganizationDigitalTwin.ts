import { OrganizationState } from "../organization/OrganizationTypes";

export class OrganizationDigitalTwin {
  public simulateRestructuring(currentState: OrganizationState, changes: any): OrganizationState {
    const simulatedState = JSON.parse(JSON.stringify(currentState));
    simulatedState.activeTasks = [];
    return simulatedState;
  }
}
