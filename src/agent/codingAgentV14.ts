import { createCodingPlannerV14 } from './codingPlannerV14.js';
import { createCodingNavigatorV14 } from './codingNavigatorV14.js';
import { runCodingSessionV14, type CodingSessionDependencies, type CodingSessionRequest } from './codingSessionV14.js';

/**
 * Trusted worker entry point for model-driven navigate/edit/create/check/repair sessions.
 * The controller holds provider credentials. Repository navigation is a two-stage
 * path-plan -> bounded local search -> scope-selection flow. The verify adapter
 * must execute repository code in an isolated container and return bounded diagnostics.
 * Never pass env into that container or expose root/verify through HTTP input.
 */
export function runCodingAgentV14(
  request: CodingSessionRequest,
  adapters: { verify: CodingSessionDependencies['verify']; plannerOptions?: Parameters<typeof createCodingPlannerV14>[0] },
) {
  return runCodingSessionV14(request, {
    discover: createCodingNavigatorV14(request.root, adapters.plannerOptions),
    propose: createCodingPlannerV14(adapters.plannerOptions),
    verify: adapters.verify,
  });
}
