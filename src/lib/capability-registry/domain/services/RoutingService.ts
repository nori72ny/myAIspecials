import { Provider, ProviderHealth } from '../entities/Provider';
import { SearchQuery, RoutingDecision } from '../../interfaces/types';

export class RoutingService {
  /**
   * Scores and ranks a collection of providers against a search query.
   * Employs a multi-dimensional scoring model based on self-declared capability rating,
   * real-time metrics (cost, latency, quality, failure rate), health status, and routing hints.
   */
  public rankProviders(providers: Provider[], query: SearchQuery): RoutingDecision {
    const requiredCapabilities = query.capabilities;
    const priority = query.priority || "balanced";

    if (providers.length === 0) {
      throw new Error("No providers available to rank.");
    }

    const scoredProviders = providers
      .filter(p => {
        // Filter by health (exclude "down" unless requested otherwise)
        const requiredHealth = query.requiredHealth || "degraded"; // default allows healthy and degraded
        if (p.health === "down") return false;
        if (requiredHealth === "healthy" && p.health !== "healthy") return false;

        // Filter by hard constraints if specified
        if (query.maxCost !== undefined && p.metrics.cost > query.maxCost) return false;
        if (query.maxLatency !== undefined && p.metrics.latency > query.maxLatency) return false;
        if (query.minQuality !== undefined && p.metrics.quality < query.minQuality) return false;
        if (query.maxFailureRate !== undefined && p.metrics.failureRate > query.maxFailureRate) return false;

        // Filter by preferred adapter if specified
        if (query.preferredAdapter !== undefined && p.adapterId !== query.preferredAdapter) return false;

        return true;
      })
      .map(p => {
        const score = this.calculateProviderScore(p, requiredCapabilities, priority, query.routingHints || []);
        return { provider: p, score };
      });

    if (scoredProviders.length === 0) {
      throw new Error(`No providers met the criteria for capabilities: ${requiredCapabilities.join(", ")}`);
    }

    // Sort descending by score
    scoredProviders.sort((a, b) => b.score - a.score);

    const primary = scoredProviders[0].provider;
    const secondaries = scoredProviders.slice(1).map(s => s.provider);

    // Build matching explanation
    const matchedCaps = requiredCapabilities.filter(c => primary.getCapabilityRating(c) > 0);
    const reason = `Selected '${primary.name}' (id: ${primary.id}) as primary provider. ` +
      `Matched capabilities: [${matchedCaps.join(", ")}]. ` +
      `System score: ${scoredProviders[0].score.toFixed(2)} (Priority: ${priority}, Health: ${primary.health}). ` +
      `Metrics: cost=${primary.metrics.cost}/10, latency=${primary.metrics.latency}ms, quality=${primary.metrics.quality}/10, failureRate=${(primary.metrics.failureRate * 100).toFixed(1)}%.`;

    return {
      primaryProvider: primary,
      secondaryProviders: secondaries,
      capabilitiesMatched: matchedCaps,
      score: scoredProviders[0].score,
      reason
    };
  }

  /**
   * Main scoring algorithm
   */
  private calculateProviderScore(
    provider: Provider,
    requiredCapabilities: string[],
    priority: "cost" | "latency" | "quality" | "balanced",
    queryHints: string[]
  ): number {
    // 1. Capability Score: Average rating of requested capabilities
    let capabilitySum = 0;
    let matchedCount = 0;

    requiredCapabilities.forEach(cap => {
      const rating = provider.getCapabilityRating(cap);
      if (rating > 0) {
        capabilitySum += rating;
        matchedCount++;
      }
    });

    // Penalize if it doesn't support some of the requested capabilities
    const capabilityMatchRate = requiredCapabilities.length > 0 
      ? matchedCount / requiredCapabilities.length 
      : 1.0;
    
    // Average capability rating normalized to 0-10 scale (self-declared is 1-5, so multiply by 2)
    const avgCapabilityRating = matchedCount > 0 ? (capabilitySum / matchedCount) * 2 : 0;
    const baseCapabilityScore = avgCapabilityRating * capabilityMatchRate;

    // 2. Metrics Score (0 to 10 scale for each metric)
    const metrics = provider.metrics;

    // Cost: lower is better (metrics.cost is 1-10, so 11 - cost normalized cheapness)
    const costScore = 11 - Math.max(1, Math.min(10, metrics.cost));

    // Latency: lower is better. Normalize 100ms - 3000ms to 0-10 score
    // Below 200ms is perfect (10), above 2500ms is poor (1)
    const latencyScore = Math.max(1, Math.min(10, 10 - ((metrics.latency - 200) / 230)));

    // Quality: higher is better (metrics.quality is 1-10)
    const qualityScore = Math.max(1, Math.min(10, metrics.quality));

    // Failure Rate: lower is better. Scale penalty: 0.0 (10) to 0.10 (0)
    const reliabilityScore = Math.max(0, Math.min(10, 10 - (metrics.failureRate * 100)));

    // 3. Weighting based on priority
    let metricsScore = 0;
    switch (priority) {
      case "cost":
        metricsScore = costScore * 0.5 + qualityScore * 0.2 + latencyScore * 0.1 + reliabilityScore * 0.2;
        break;
      case "latency":
        metricsScore = latencyScore * 0.5 + reliabilityScore * 0.3 + qualityScore * 0.1 + costScore * 0.1;
        break;
      case "quality":
        metricsScore = qualityScore * 0.5 + reliabilityScore * 0.3 + latencyScore * 0.1 + costScore * 0.1;
        break;
      case "balanced":
      default:
        metricsScore = (costScore + latencyScore + qualityScore + reliabilityScore) / 4;
        break;
    }

    // 4. Health Penalty
    let healthMultiplier = 1.0;
    if (provider.health === "degraded") {
      healthMultiplier = 0.6; // 40% penalty for degraded health
    }

    // 5. Routing Hints Bonus
    let hintsBonus = 0;
    if (queryHints.length > 0) {
      const matchedHints = queryHints.filter(hint => provider.routingHints.includes(hint));
      hintsBonus = (matchedHints.length / queryHints.length) * 2.0; // max +2.0 bonus points
    }

    // Total Score Formula: (Capability Weight * capabilityWeight + Metrics Weight * metricsWeight) * Health + Hints
    const capabilityWeight = (priority === "balanced" || priority === "quality") ? 0.6 : 0.3;
    const metricsWeight = 1.0 - capabilityWeight;
    const totalScore = (baseCapabilityScore * capabilityWeight + metricsScore * metricsWeight) * healthMultiplier + hintsBonus;

    return Math.max(0, totalScore);
  }
}
