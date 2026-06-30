import { MissionId, UserId } from "../types/BrandedTypes";
import { MissionStatus } from "./MissionStatus";
import { InvalidStateTransitionError, DomainInvariantViolationError } from "../errors/DomainErrors";
import { DomainEvent } from "../events/DomainEvent";
import { TaskGraph } from "./TaskGraph";
import * as crypto from "crypto";

export class Mission {
  private _id: MissionId;
  private _objective: string;
  private _status: MissionStatus;
  private _successCriteria: string[];
  private _taskGraph: TaskGraph;
  private _version: number = 1;
  private _domainEvents: DomainEvent[] = [];

  // Factoryからのみ生成可能にするため private constructor
  private constructor(id: MissionId, objective: string, successCriteria: string[]) {
    this._id = id;
    this._objective = objective;
    this._status = MissionStatus.Draft;
    this._successCriteria = successCriteria;
    this._taskGraph = new TaskGraph();
  }

  // Aggregate Root再構築用
  static rehydrate(id: MissionId, objective: string, status: MissionStatus, successCriteria: string[], taskGraph: TaskGraph, version: number = 1): Mission {
    const mission = new Mission(id, objective, successCriteria);
    mission._status = status;
    mission._taskGraph = taskGraph;
    mission._version = version;
    return mission;
  }

  static create(id: MissionId, objective: string, successCriteria: string[]): Mission {
    if (successCriteria.length < 3) {
      throw new DomainInvariantViolationError('MISS-INV-001', 'A Mission must have at least 3 success criteria.');
    }
    const mission = new Mission(id, objective, successCriteria);
    mission.addDomainEvent({
      eventId: crypto.randomUUID(),
      eventType: 'MissionCreated',
      aggregateId: mission.id,
      aggregateType: 'Mission',
      occurredAt: new Date(),
      payload: { objective, successCriteria }
    });
    return mission;
  }

  get id(): MissionId { return this._id; }
  get status(): MissionStatus { return this._status; }
  get objective(): string { return this._objective; }
  get taskGraph(): TaskGraph { return this._taskGraph; }
  get successCriteria(): string[] { return [...this._successCriteria]; }
  get version(): number { return this._version; }

  private addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  approve(approvedBy: UserId): void {
    if (this._status !== MissionStatus.Draft) {
      throw new InvalidStateTransitionError(this._status, MissionStatus.Approved);
    }
    this._status = MissionStatus.Approved;
    this._version++;
    this.addDomainEvent({
      eventId: crypto.randomUUID(),
      eventType: 'MissionApproved',
      aggregateId: this.id,
      aggregateType: 'Mission',
      occurredAt: new Date(),
      payload: { approvedBy }
    });
  }

  activate(): void {
    if (this._status !== MissionStatus.Approved) {
      throw new InvalidStateTransitionError(this._status, MissionStatus.Active);
    }
    this._status = MissionStatus.Active;
    this._version++;
    this.addDomainEvent({
      eventId: crypto.randomUUID(),
      eventType: 'MissionActivated',
      aggregateId: this.id,
      aggregateType: 'Mission',
      occurredAt: new Date(),
      payload: {}
    });
  }

  startReview(): void {
    if (this._status !== MissionStatus.Active) {
      throw new InvalidStateTransitionError(this._status, MissionStatus.Reviewing);
    }
    this._status = MissionStatus.Reviewing;
    this._version++;
    this.addDomainEvent({
      eventId: crypto.randomUUID(),
      eventType: 'MissionReviewStarted',
      aggregateId: this.id,
      aggregateType: 'Mission',
      occurredAt: new Date(),
      payload: {}
    });
  }

  complete(completedBy: UserId): void {
    if (this._status !== MissionStatus.Reviewing) {
      throw new InvalidStateTransitionError(this._status, MissionStatus.Completed, 'Mission must be in Reviewing state to be completed.');
    }
    this._status = MissionStatus.Completed;
    this._version++;
    this.addDomainEvent({
      eventId: crypto.randomUUID(),
      eventType: 'MissionCompleted',
      aggregateId: this.id,
      aggregateType: 'Mission',
      occurredAt: new Date(),
      payload: { completedBy }
    });
  }

  discontinue(discontinuedBy: UserId, reason: string): void {
    if (this._status === MissionStatus.Completed || this._status === MissionStatus.Discontinued) {
      throw new InvalidStateTransitionError(this._status, MissionStatus.Discontinued);
    }
    this._status = MissionStatus.Discontinued;
    this._version++;
    this.addDomainEvent({
      eventId: crypto.randomUUID(),
      eventType: 'MissionDiscontinued',
      aggregateId: this.id,
      aggregateType: 'Mission',
      occurredAt: new Date(),
      payload: { discontinuedBy, reason }
    });
  }
}
