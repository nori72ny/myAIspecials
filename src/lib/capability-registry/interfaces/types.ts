import { Provider, ProviderHealth, ProviderMetrics } from '../domain/entities/Provider';
import { Capability } from '../domain/entities/Capability';

export interface SearchQuery {
  capabilities: string[];
  priority?: "cost" | "latency" | "quality" | "balanced";
  requiredHealth?: ProviderHealth;
  maxCost?: number;
  maxLatency?: number;
  minQuality?: number;
  maxFailureRate?: number;
  preferredAdapter?: string;
  routingHints?: string[];
}

export interface RoutingDecision {
  primaryProvider: Provider;
  secondaryProviders: Provider[];
  capabilitiesMatched: string[];
  score: number;
  reason: string;
}

export interface ICapabilityRegistry {
  registerCapability(capability: Capability): void;
  registerProvider(provider: Provider): void;
  unregisterProvider(providerId: string): void;
  getProvider(providerId: string): Provider | undefined;
  getProvidersByCapability(capability: string): Provider[];
  searchAndRank(query: SearchQuery): RoutingDecision;
  updateProviderHealth(providerId: string, health: ProviderHealth): void;
  updateProviderMetrics(providerId: string, metrics: Partial<ProviderMetrics>): void;
}

export interface IProviderAdapter {
  id: string; // e.g., "OpenRouter", "Google", "Anthropic"
  getSelfDeclaredProviders(): Promise<Provider[]>;
}
