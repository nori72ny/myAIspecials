import { ICapabilityRegistry, SearchQuery, RoutingDecision } from '../interfaces/types';
import { Provider, ProviderHealth, ProviderMetrics } from '../domain/entities/Provider';
import { Capability } from '../domain/entities/Capability';
import { RoutingService } from '../domain/services/RoutingService';
import { globalEventBus } from '../../kernel/events/EventBus';

export class CapabilityRegistry implements ICapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map();
  private providers: Map<string, Provider> = new Map();
  private routingService: RoutingService;

  constructor(routingService?: RoutingService) {
    this.routingService = routingService || new RoutingService();
  }

  /**
   * Register a new Capability definition
   */
  public registerCapability(capability: Capability): void {
    this.capabilities.set(capability.name, capability);
    
    // We can emit a capability registered event if needed
    console.log(`[CapabilityRegistry] Capability registered: ${capability.name}`);
  }

  /**
   * Register a new Provider
   */
  public registerProvider(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider with id '${provider.id}' is already registered.`);
    }

    this.providers.set(provider.id, provider);

    // Publish event
    globalEventBus.publish('ProviderRegistered' as any, {
      eventId: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      providerId: provider.id,
      name: provider.name,
      adapterId: provider.adapterId,
      capabilities: Array.from(provider.capabilities.keys())
    } as any).catch(err => console.error("Event publication error:", err));

    console.log(`[CapabilityRegistry] Provider registered: ${provider.name} (id: ${provider.id})`);
  }

  /**
   * Unregister an existing Provider
   */
  public unregisterProvider(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    this.providers.delete(providerId);

    // Publish event
    globalEventBus.publish('ProviderUnregistered' as any, {
      eventId: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      providerId
    } as any).catch(err => console.error("Event publication error:", err));

    console.log(`[CapabilityRegistry] Provider unregistered: ${providerId}`);
  }

  /**
   * Retrieve a registered provider by ID
   */
  public getProvider(providerId: string): Provider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all registered providers
   */
  public getAllProviders(): Provider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Filter providers that declare a rating for a specific capability
   */
  public getProvidersByCapability(capability: string): Provider[] {
    return Array.from(this.providers.values()).filter(p => p.getCapabilityRating(capability) > 0);
  }

  /**
   * Main Search and Rank function
   */
  public searchAndRank(query: SearchQuery): RoutingDecision {
    // Collect all providers that support at least one of the requested capabilities
    const candidates = Array.from(this.providers.values()).filter(provider => 
      query.capabilities.some(cap => provider.getCapabilityRating(cap) > 0)
    );

    // If no candidate exists, fall back to all healthy providers to avoid hard failure
    const finalCandidates = candidates.length > 0 
      ? candidates 
      : Array.from(this.providers.values()).filter(p => p.health !== "down");

    const decision = this.routingService.rankProviders(finalCandidates, query);

    // Publish event
    globalEventBus.publish('CapabilityRouted' as any, {
      eventId: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      requestedCapabilities: query.capabilities,
      priority: query.priority || "balanced",
      selectedProviderId: decision.primaryProvider.id,
      score: decision.score
    } as any).catch(err => console.error("Event publication error:", err));

    return decision;
  }

  /**
   * Update Provider Health and emit events
   */
  public updateProviderHealth(providerId: string, health: ProviderHealth): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    const oldHealth = provider.health;
    if (oldHealth === health) return;

    provider.updateHealth(health);

    // Publish event
    globalEventBus.publish('ProviderHealthChanged' as any, {
      eventId: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      providerId,
      oldHealth,
      newHealth: health
    } as any).catch(err => console.error("Event publication error:", err));

    console.log(`[CapabilityRegistry] Provider health changed for ${providerId}: ${oldHealth} -> ${health}`);
  }

  /**
   * Update Provider Metrics and emit events
   */
  public updateProviderMetrics(providerId: string, metrics: Partial<ProviderMetrics>): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    provider.updateMetrics(metrics);

    // Publish event
    globalEventBus.publish('ProviderMetricsUpdated' as any, {
      eventId: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      providerId,
      metrics: provider.metrics
    } as any).catch(err => console.error("Event publication error:", err));
  }
}
