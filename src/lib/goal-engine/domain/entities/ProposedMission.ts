export class ProposedMission {
  constructor(
    public readonly missionId: string,
    public readonly title: string,
    public readonly description: string,
    public readonly successCriteria: string,
    public readonly order: number
  ) {}
}
