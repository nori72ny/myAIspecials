export type GoalStatus = "pending" | "clarifying" | "formulating" | "executing" | "achieved" | "failed";

export class Goal {
  constructor(
    public readonly id: string,
    public readonly rawInput: string,
    public readonly userId: string,
    public status: GoalStatus = "pending",
    public readonly createdAt: number = Date.now()
  ) {}

  public updateStatus(newStatus: GoalStatus): void {
    this.status = newStatus;
  }
}
