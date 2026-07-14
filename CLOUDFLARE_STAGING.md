# ACOS 2.0 Cloudflare Staging Plan

## Decision

Use Cloudflare Pages for the static Vite frontend and Cloudflare Workers for server-side API routes. Do not use Render.

## Zero-cost constraints

- Remain on the Cloudflare Workers Free plan.
- Do not enable the Workers Paid plan.
- Keep `FREE_ONLY=true` for all AI requests.
- Store `OPENROUTER_API_KEY` only as an encrypted Worker secret.
- Do not configure Gemini, OpenAI, Anthropic, or Perplexity provider keys.
- Treat quota exhaustion as a controlled service-unavailable condition; never fall back to a paid model or paid platform tier.

## Migration sequence

1. Keep the existing Express server as the local and container reference implementation.
2. Extract route-independent application services from Express handlers.
3. Implement a Worker `fetch` entry point for `/health` and selected `/api/v1/*` routes.
4. Build and publish the Vite frontend to Cloudflare Pages preview only.
5. Bind the Pages frontend to the Worker API URL through environment configuration.
6. Add smoke tests for `/health`, dashboard loading, settings, and OpenRouter free-model failure handling.
7. Promote from preview to production only after explicit approval.

## Compatibility notes

The current Express/Vite middleware server cannot be deployed unchanged to Workers. Workers use a request/response `fetch` handler rather than a long-running Node.js listener. Node.js compatibility APIs may help shared libraries, but HTTP routing and startup code must be adapted.

## Initial scope

The first Worker increment should expose only:

- `GET /health`
- one read-only or deterministic API endpoint
- one OpenRouter-backed endpoint with strict `:free` model validation

This limits migration risk and keeps CPU usage within the free-plan envelope.

## Deployment gate

No Cloudflare project, Worker, Pages site, API token, or DNS change may be created until the migration PR passes all repository checks and the owner explicitly approves deployment.
