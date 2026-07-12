export type ProviderHealth = "healthy" | "degraded" | "down";

export interface ProviderMetrics {
  cost: number;        // Cost score (1-10, lower is cheaper)
  latency: number;     // Average latency in milliseconds
  quality: number;     // Quality score (1-10, higher is better)
  failureRate: number; // Failure rate (0.0 to 1.0, lower is better)
  
  // Phase 1: Adaptive Learning Engine Extended Metrics
  successRate?: number;          // 0.0 to 100.0 (percentage)
  averageResponseTime?: number;  // ms
  averageTruthScore?: number;    // 0.0 to 100.0
  averageConfidence?: number;    // 0.0 to 100.0
  averageResearchScore?: number;  // 0.0 to 100.0
  runsCount?: number;            // Track total runs
}

export class Provider {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly adapterId: string, // e.g. "OpenRouter", "Google", "Anthropic"
    public readonly capabilities: Map<string, number>, // Self-declared score (1 to 5)
    public health: ProviderHealth = "healthy",
    public metrics: ProviderMetrics = { cost: 5, latency: 500, quality: 7, failureRate: 0.01 },
    public routingHints: string[] = []
  ) {
    this.validateAndClamp();
  }

  private validateAndClamp(): void {
    // Clamp metrics
    const cost = Math.max(1, Math.min(10, this.metrics.cost));
    const latency = Math.max(0, this.metrics.latency);
    const quality = Math.max(1, Math.min(10, this.metrics.quality));
    const failureRate = Math.max(0.0, Math.min(1.0, this.metrics.failureRate));
    
    const successRate = this.metrics.successRate !== undefined ? Math.max(0, Math.min(100, this.metrics.successRate)) : 99.0;
    const averageResponseTime = this.metrics.averageResponseTime !== undefined ? Math.max(0, this.metrics.averageResponseTime) : latency;
    const averageTruthScore = this.metrics.averageTruthScore !== undefined ? Math.max(0, Math.min(100, this.metrics.averageTruthScore)) : 95.0;
    const averageConfidence = this.metrics.averageConfidence !== undefined ? Math.max(0, Math.min(100, this.metrics.averageConfidence)) : 95.0;
    const averageResearchScore = this.metrics.averageResearchScore !== undefined ? Math.max(0, Math.min(100, this.metrics.averageResearchScore)) : 95.0;
    const runsCount = this.metrics.runsCount !== undefined ? Math.max(0, this.metrics.runsCount) : 1;

    this.metrics = { 
      cost, 
      latency, 
      quality, 
      failureRate,
      successRate,
      averageResponseTime,
      averageTruthScore,
      averageConfidence,
      averageResearchScore,
      runsCount
    };

    // Clamp capabilities
    for (const [key, value] of this.capabilities.entries()) {
      const clampedValue = Math.max(1, Math.min(5, value));
      this.capabilities.set(key, clampedValue);
    }
  }

  public updateHealth(health: ProviderHealth): void {
    this.health = health;
  }

  public updateMetrics(newMetrics: Partial<ProviderMetrics>): void {
    this.metrics = { ...this.metrics, ...newMetrics };
    this.validateAndClamp();
  }

  public getCapabilityRating(capability: string): number {
    return this.capabilities.get(capability) || 0;
  }

  public addRoutingHint(hint: string): void {
    if (!this.routingHints.includes(hint)) {
      this.routingHints.push(hint);
    }
  }

  public removeRoutingHint(hint: string): void {
    this.routingHints = this.routingHints.filter(h => h !== hint);
  }
}
