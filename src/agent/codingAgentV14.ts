import { createCodingPlannerV14 } from './codingPlannerV14.js';
import { createCodingScoutV14 } from './codingScoutV14.js';
import { runCodingSessionV14, type CodingSessionDependencies, type CodingSessionRequest } from './codingSessionV14.js';

/**
 * Trusted worker entry point for model-driven discover/edit/create/check/repair sessions.
 * The controller holds provider credentials. The verify adapter must execute
 * repository code in an isolated container and return bounded diagnostics.
 * Never pass env into that container or expose root/verify through HTTP input.
 */
export function runCodingAgentV14(
  request: CodingSessionRequest,
  adapters: { verify: CodingSessionDependencies['verify']; plannerOptions?: Parameters<typeof createCodingPlannerV14>[0] },
) {
  return runCodingSessionV14(request, {
    discover: createCodingScoutV14(adapters.plannerOptions),
    propose: createCodingPlannerV14(adapters.plannerOptions),
    verify: adapters.verify,
  });
}
