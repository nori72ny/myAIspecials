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

## Performance guardrails

- Serve the Vite frontend as static Pages assets so normal navigation does not wake a server process.
- Keep the Worker dependency-free until a framework provides measurable value.
- Keep health and status routes deterministic and independent of OpenRouter.
- Limit AI prompt input to 4,000 characters and output to 700 tokens for predictable latency and free-tier usage.
- Abort OpenRouter requests after 8 seconds and return a recoverable service-unavailable response instead of leaving the UI waiting.
- Never retry paid or automatic routing. The client may offer a manual retry for the same explicit `:free` model.
- Do not cache private AI prompts or responses at the edge.

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

## Initial Worker scope

The first Worker increment exposes:

- `GET /health`
- `GET /api/v1/status`
- `POST /api/v1/ai/free-chat`

The AI endpoint requires `FREE_ONLY=true`, an encrypted OpenRouter key, and a model ID explicitly marked as free. It does not use OpenRouter automatic routing or paid fallback.

## Deployment gate

No Cloudflare project, Worker, Pages site, API token, or DNS change may be created until the migration PR passes all repository checks and the owner explicitly approves deployment.
