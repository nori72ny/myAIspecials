import { TaskId, AgentId, MissionId } from "../types/BrandedTypes";
import { InvalidStateTransitionError } from "../errors/DomainErrors";

export enum TaskStatus {
  Pending = 'Pending',
  InProgress = 'InProgress',
  Completed = 'Completed',
  Failed = 'Failed'
}

export class Task {
  private _id: TaskId;
  private _missionId: MissionId;
  private _description: string;
  private _assignedAgentId?: AgentId;
  private _status: TaskStatus;
  private _result?: string;

  constructor(id: TaskId, missionId: MissionId, description: string) {
    this._id = id;
    this._missionId = missionId;
    this._description = description;
    this._status = TaskStatus.Pending;
  }

  get id(): TaskId { return this._id; }
  get missionId(): MissionId { return this._missionId; }
  get status(): TaskStatus { return this._status; }
  get assignedAgentId(): AgentId | undefined { return this._assignedAgentId; }
  get description(): string { return this._description; }
  get result(): string | undefined { return this._result; }

  assign(agentId: AgentId): void {
    if (this._status !== TaskStatus.Pending) {
      throw new InvalidStateTransitionError(this._status, 'Assigned (Implicit)', 'Task must be pending to be assigned');
    }
    this._assignedAgentId = agentId;
  }

  start(): void {
    if (this._status !== TaskStatus.Pending) {
      throw new InvalidStateTransitionError(this._status, TaskStatus.InProgress);
    }
    if (!this._assignedAgentId) {
      throw new Error('Cannot start unassigned task');
    }
    this._status = TaskStatus.InProgress;
  }

  complete(result: string): void {
    if (this._status !== TaskStatus.InProgress) {
      throw new InvalidStateTransitionError(this._status, TaskStatus.Completed);
    }
    this._status = TaskStatus.Completed;
    this._result = result;
  }

  fail(reason: string): void {
    if (this._status !== TaskStatus.InProgress) {
      throw new InvalidStateTransitionError(this._status, TaskStatus.Failed);
    }
    this._status = TaskStatus.Failed;
    this._result = reason;
  }
}
