export class Intent {
  constructor(
    public readonly goalId: string,
    public readonly clarifiedObjective: string,
    public readonly contextUsed: string[],
    public readonly successCriteria: string,
    public readonly constraints: string[] = [],
    public readonly targetAudience?: string
  ) {}
}
