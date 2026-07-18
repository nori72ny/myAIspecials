# ORIGIN Product Constitution

Version: 1.0  
Status: Foundational  
Applies to: Product, design, orchestration, benchmarking, cost control, safety, and future AI integrations

## 1. Immutable Vision

ORIGIN automatically selects the best available AI, tool, agent, or combination for each user request and, when useful, coordinates independent generation, review, verification, and synthesis to deliver a world-class result that is accurate, understandable, actionable, safe, and cost-efficient.

The slogan and core product direction remain stable. New AI services, models, interfaces, and capabilities may improve the implementation, but they do not replace the mission.

## 2. Mission

Users should not need to understand the strengths, weaknesses, pricing, interfaces, or release cycles of individual AI services. ORIGIN converts a user objective into the best practical outcome by selecting and coordinating the appropriate capabilities.

The product optimizes for the final outcome, not for model popularity, provider branding, or the number of models used.

## 3. Fixed Objectives

ORIGIN shall:

1. Support a broad range of use cases, including conversation, research, coding, software maintenance, planning, analysis, writing, document production, data work, creative production, multimodal tasks, and autonomous execution.
2. Support current and future AI services through extensible adapters and capability-based routing.
3. Evaluate individual AI services and multi-AI workflows by domain, task type, language, difficulty, safety, completion rate, latency, and cost.
4. Present results in a form that is immediately understandable to non-experts while preserving evidence, uncertainty, provenance, and audit detail for experts.
5. Prefer free or low-cost execution when quality remains sufficient.
6. Require explicit approval when an operation exceeds configured cost, risk, privacy, publication, deletion, payment, or production-change thresholds.
7. Continuously improve routing, orchestration, evaluation, synthesis, and presentation using benchmark and production evidence.

## 4. Fixed Cost Conditions

The original cost policy remains unchanged.

- Prefer free tiers, local execution, existing subscriptions, cached results, and low-cost models when they meet the required quality level.
- Do not run multiple models merely to create the appearance of sophistication.
- Use additional models only when the expected quality, safety, or completion improvement justifies the additional cost and latency.
- Show estimated cost before execution when the request may exceed the configured approval threshold.
- Never create a paid account, purchase a subscription, enable billing, or commit to recurring cost automatically.
- Enforce per-request, daily, monthly, provider, and project-level budget limits.
- Record estimated and actual cost so routing can improve over time.

Cost optimization must not conceal material uncertainty or create unsafe outcomes.

## 5. Outcome-First Evaluation

ORIGIN evaluates the completed result rather than assuming that a famous or high-scoring model is best.

Evaluation can include:

- factual correctness;
- instruction adherence;
- completeness;
- clarity and information architecture;
- actionability;
- source quality and citation integrity;
- code tests, type checks, linting, and runtime validation;
- tool-use success;
- artifact quality;
- task completion rate;
- safety and privacy;
- latency and cost;
- required human intervention;
- user acceptance, correction, and retry rates.

A single overall score must never hide critical failures. Safety, factuality, and task completion are independent gates.

## 6. Capability-Based, Provider-Neutral Architecture

Model names and providers must not be hardcoded into product decisions.

Routing is based on capability requirements and measured evidence, including:

- reasoning;
- research and retrieval;
- coding and repository work;
- tool use and autonomous execution;
- writing and editing;
- multilingual performance;
- multimodal understanding and generation;
- structured output;
- long-context processing;
- domain expertise;
- safety;
- latency;
- cost;
- availability and reliability.

Provider-specific behavior is isolated behind adapters. A future service can participate after compatibility, security, policy, and benchmark review without redesigning the orchestration core.

## 7. Initial AI Service Landscape

The initial benchmark catalog includes, but is not limited to:

- ChatGPT;
- Claude;
- Gemini;
- Codex;
- Claude Code;
- Manus;
- Perplexity;
- Genspark;
- other current AI services;
- local and open models;
- enterprise and specialist systems;
- future services not yet available.

These entries are not permanent leaders. Their roles and rankings are determined by current measured performance for each use case.

## 8. Domain-Specific Benchmarking

ORIGIN does not maintain one universal leaderboard. It maintains domain and task profiles.

Initial benchmark domains include:

- general assistance and learning;
- current-information research and fact-checking;
- software development and repository maintenance;
- autonomous task execution;
- data analysis and visualization;
- business analysis and decision support;
- writing, editing, and translation;
- documents, slides, spreadsheets, and web artifacts;
- image, audio, video, and multimodal work;
- legal, medical, financial, scientific, and other specialist domains;
- safety, privacy, and policy compliance.

Each benchmark must state its task definition, inputs, expected outcome, evaluation method, evaluator version, cost basis, and confidence level.

## 9. Multi-AI Orchestration Principles

Multiple AI services are used only when they provide measurable value.

Supported patterns include:

- single best model;
- primary model plus reviewer;
- independent parallel candidates;
- researcher, analyst, critic, and editor roles;
- coding agent plus test and security review;
- retrieval service plus synthesis model;
- agent execution plus independent verification;
- specialist consultation plus final editorial synthesis.

For important tasks, initial candidate answers should be independent where practical to reduce anchoring and error propagation.

Synthesis must not average responses mechanically. It should extract claims, identify agreement and conflict, verify evidence, remove unsupported content, resolve contradictions, and reconstruct a coherent final result.

## 10. Progressive Disclosure and Result Design

The result interface must serve both non-experts and experts.

Default view:

1. conclusion;
2. recommended action;
3. essential evidence;
4. important caveats;
5. next step.

Expandable detail:

- selection rationale;
- models, tools, and roles used;
- claim-level verification;
- sources and provenance;
- disagreements and unresolved uncertainty;
- cost and latency;
- candidate answers;
- benchmark and routing versions;
- audit log.

The interface must not expose complexity merely because complexity exists internally.

## 11. Safety, Privacy, and Approval

ORIGIN must distinguish advisory generation from consequential execution.

Explicit approval is required for operations such as:

- exceeding configured cost thresholds;
- sending external messages;
- publishing content;
- deleting or overwriting data;
- making payments or purchases;
- modifying production systems;
- changing access control;
- transmitting sensitive data to a new provider;
- accepting legal or financial commitments.

Sensitive data must be minimized, classified, and routed only to approved providers and environments.

## 12. AI Evolution System

New and updated AI services follow a controlled lifecycle:

1. Discovered
2. Compatibility review
3. Security and policy review
4. Sandbox benchmark
5. Shadow evaluation
6. Limited trial
7. Approved
8. Preferred for specific domains
9. Restricted, deprecated, or removed when performance or policy changes

Official provider claims are treated as capability leads, not proof of superiority. Internal benchmarks, independent evidence, and production outcomes carry greater weight.

## 13. Continuous Improvement

ORIGIN continuously evaluates:

- which AI performed best for each task type;
- which combination produced the best completed outcome;
- when review improved quality;
- when additional execution was wasteful;
- which evaluator aligned with human judgment;
- which result format reduced confusion and retries;
- where cost, latency, reliability, or provider behavior changed.

Learning uses anonymized and aggregated production signals only under the applicable privacy and consent policy.

## 14. Versioning and Reproducibility

Every material decision must be reproducible with versioned metadata, including:

- task-analysis version;
- model catalog version;
- capability schema version;
- routing policy version;
- benchmark version;
- evaluation policy version;
- synthesis policy version;
- cost policy version;
- selected models and tools;
- decision rationale;
- estimated and actual cost;
- execution and verification outcomes.

## 15. Definition of World-Class

"World-class" is a measurable product requirement, not an unsupported claim.

ORIGIN should demonstrate improvement against relevant baselines through controlled evaluation of:

- answer correctness;
- task completion;
- user comprehension;
- time to useful action;
- source and citation quality;
- reliability;
- safety;
- cost-adjusted quality;
- latency-adjusted quality;
- human correction and intervention rates.

Claims of superiority must identify the comparison set, task domain, test date, sample size, methodology, and uncertainty.

## 16. Change Control

The following require explicit product-owner approval:

- changing the core slogan, vision, mission, or original cost principles;
- introducing automatic paid subscriptions or purchases;
- weakening safety, privacy, evidence, or approval requirements;
- making a single provider mandatory without a documented fallback;
- replacing outcome-based evaluation with provider-based ranking.

Implementation details, supported services, capability definitions, benchmark tasks, and interface patterns may evolve when they remain consistent with this constitution.

## 17. Immediate Implementation Order

1. Product constitution and specification index
2. AI service catalog and provider-neutral types
3. Capability registry
4. Benchmark schema and domain taxonomy
5. Cost and approval policy
6. Task analyzer and execution planner
7. Result schema and progressive-disclosure UI
8. Provider adapters
9. Evaluator and synthesis engine
10. Shadow evaluation and continuous-learning loop

This order preserves the original low-cost development condition by completing the architecture and mock execution path before broad paid API integration.
