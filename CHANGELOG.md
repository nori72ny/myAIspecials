# Changelog

All notable changes to the AI Operating System (ACOS) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0-rc.1] - 2026-07-01
### Added
- **Dynamic Agent Organizations (Orgs)**: Introduced `OrganizationAggregate` root to represent collaborative federated workspaces capable of scaling to 1,000+ active agents.
- **Organization Execution Engine (OEE)**: Designed to coordinate and schedule task execution across organizational hierarchies.
- **Organization Evolution Engine (OEvE)**: Self-improving framework designed to optimize organizational memory, relationship weights, and workflow topologies over time.
- **Playwright E2E Suite**: Full integration test coverage verifying a complete round-trip mission trace (API tests, UI interactions, and dashboard metrics).
- **Self-Healing Error Recovery**: Exponential backoff routing for AI models and local backup/restoration for corrupt states.
- **Prompt Escape Filters**: Adversarial sanitization layer to mitigate injection attacks, system overrides, and prompt leakage.
- **Multi-Tenant Workspace Isolation**: Ensured independent execution threads and strict memory boundary partitions.

### Changed
- **Modular Frontend Layout**: Refactored the dashboard frontend to decouple standard views from backend proxy routes, improving LCP to **1.2s**.
- **Gemini SDK Migration**: Upgraded model orchestration layer to use the modern `@google/genai` TypeScript SDK exclusively on the secure server side.
- **Server Bundling Configuration**: Optimized `esbuild` configuration in `package.json` to compile `server.ts` into a self-contained CommonJS target (`dist/server.cjs`) to ensure reliable deployment.

### Removed
- **Direct Client-Side Keys**: Removed all direct/public browser keys to prevent API credential leaks.
- **Legacy Retry Mechanisms**: Retired old, blocking API polling strategies in favor of robust asynchronous state management.

---

## [1.5.0] - 2026-04-15
### Added
- **Prompt Library Management**: Standardized system templates and prompt collections with tag categorization.
- **Dynamic Workflow Builder**: Enabled graphical and declarative workflow layout generation.
- **Shared Memory Explorer**: Added primitive visual mapping for agent memory clusters.

### Changed
- **React 18 Upgrade**: Migrated UI and layout structures to React 18 and Vite.
- **Tailwind v4 Integration**: Leveraged modernized Tailwind compiler rules for responsive design presets.

---

## [1.0.0] - 2026-01-10
### Added
- **Initial Core Runtime**: Supported single mission executions with isolated individual agents.
- **Agent Governance Records**: Enabled basic lifecycle tracing, status monitoring, and authorization management.
- **Safe Tool Execution**: Implemented basic sandbox routing for automated script executions.
