import * as crypto from "crypto";

export class ExecutionContext {
  public readonly correlationId: string;
  public readonly missionId: string;
  public readonly startTime: Date;
  private metadata: Map<string, any> = new Map();

  constructor(missionId: string, correlationId?: string) {
    this.missionId = missionId;
    this.correlationId = correlationId || `corr-${crypto.randomUUID()}`;
    this.startTime = new Date();
  }

  public set(key: string, value: any): void {
    this.metadata.set(key, value);
  }

  public get<T>(key: string): T | undefined {
    return this.metadata.get(key) as T;
  }

  public getDurationMs(): number {
    return Date.now() - this.startTime.getTime();
  }
}
