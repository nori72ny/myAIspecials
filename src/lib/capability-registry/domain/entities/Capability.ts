export class Capability {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly category: "reasoning" | "generation" | "perception" | "utility" | "domain-specific" = "utility"
  ) {}
}
