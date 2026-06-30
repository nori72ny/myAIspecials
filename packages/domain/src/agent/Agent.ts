import { AgentId } from "../types/BrandedTypes";
import { InvalidStateTransitionError } from "../errors/DomainErrors";

export enum AgentStatus {
  Available = 'Available',
  Assigned = 'Assigned',
  Working = 'Working',
  Unavailable = 'Unavailable'
}

export class Agent {
  private _id: AgentId;
  private _role: string;
  private _capabilities: string[];
  private _status: AgentStatus;

  constructor(id: AgentId, role: string, capabilities: string[]) {
    this._id = id;
    this._role = role;
    this._capabilities = capabilities;
    this._status = AgentStatus.Available;
  }

  get id(): AgentId { return this._id; }
  get role(): string { return this._role; }
  get status(): AgentStatus { return this._status; }
  get capabilities(): string[] { return [...this._capabilities]; }

  assign(): void {
    if (this._status !== AgentStatus.Available) {
      throw new InvalidStateTransitionError(this._status, AgentStatus.Assigned);
    }
    this._status = AgentStatus.Assigned;
  }

  startWorking(): void {
    if (this._status !== AgentStatus.Assigned) {
      throw new InvalidStateTransitionError(this._status, AgentStatus.Working);
    }
    this._status = AgentStatus.Working;
  }

  completeWork(): void {
    if (this._status !== AgentStatus.Working) {
      throw new InvalidStateTransitionError(this._status, AgentStatus.Available);
    }
    this._status = AgentStatus.Available;
  }

  markUnavailable(): void {
    this._status = AgentStatus.Unavailable;
  }
}
