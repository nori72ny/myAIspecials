# ORIGIN Result and UX Specification

Status: Active Draft  
Governing documents:

- [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)
- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)
- [AI_ORCHESTRATION_SPEC.md](./AI_ORCHESTRATION_SPEC.md)
- [BENCHMARK_SPEC.md](./BENCHMARK_SPEC.md)
- [COST_AND_APPROVAL_POLICY.md](./COST_AND_APPROVAL_POLICY.md)

## 1. Purpose

This specification defines how ORIGIN presents requests, execution plans, approvals, progress, results, evidence, uncertainty, cost, and audit detail.

The interface must make a complex multi-AI runtime feel like one coherent expert service. Users should receive the best available outcome without needing to understand individual providers, models, prompts, evaluators, retries, or execution graphs.

The interface must preserve transparency where it materially affects trust, cost, safety, or user control.

## 2. UX Objectives

ORIGIN shall optimize the user experience for:

1. fast comprehension;
2. minimal user effort;
3. clear recommendations;
4. informed approval;
5. visible uncertainty;
6. traceable evidence;
7. predictable cost;
8. safe consequential actions;
9. graceful partial completion;
10. progressive disclosure for experts.

The default experience shall be simple. Complexity shall be available, not imposed.

## 3. Product Experience Principle

The user interacts with a mission or task, not a list of AI providers.

Provider and model identities may appear in technical or audit views, but they shall not be the primary navigation model.

The primary question presented by the interface is:

> What outcome is being produced, how reliable is it, what will it cost, and what requires user approval?

## 4. Core Interaction States

Every request shall move through explicit user-visible states.

```text
Draft
→ Analyzing
→ Plan Ready
→ Awaiting Approval, when required
→ Executing
→ Evaluating
→ Synthesizing
→ Completed, Partially Completed, Blocked, Cancelled, or Failed
```

The system shall not present internal implementation states as unexplained technical errors.

## 5. Primary Screens

The initial product shall support the following primary screens or panels:

1. Request Composer;
2. Task Understanding Summary;
3. Execution Plan Preview;
4. Approval Review;
5. Execution Progress;
6. Result Workspace;
7. Evidence and Uncertainty View;
8. Cost and Usage View;
9. Expert Audit View;
10. History and Reopen View.

These may be implemented as routes, drawers, panels, tabs, or responsive sections, provided the information hierarchy remains consistent.

## 6. Request Composer

### 6.1 Required Behavior

The request composer shall allow the user to:

- describe the desired outcome in natural language;
- attach relevant files or references;
- specify deadlines or freshness needs;
- specify budget preferences;
- specify privacy constraints;
- choose whether external actions are allowed;
- select Automatic, Fast, or Deliberation mode where exposed;
- submit without selecting an AI provider.

### 6.2 Default Mode

Automatic shall be the default.

The system shall infer the lowest-complexity plan capable of meeting the required quality and safety thresholds.

### 6.3 Advanced Controls

Advanced controls may expose:

- maximum budget;
- target completion time;
- preferred data region;
- permitted providers;
- prohibited providers;
- required evidence level;
- required reviewer independence;
- allowed tools;
- maximum autonomous steps;
- output format.

Advanced controls shall be collapsed by default.

### 6.4 Clarification

The system shall ask a clarification question only when missing information materially changes:

- the requested outcome;
- safety;
- legality;
- privacy;
- cost;
- approval scope;
- external side effects;
- quality requirements.

Clarification shall be concise and shall explain the decision affected.

## 7. Task Understanding Summary

Before execution, ORIGIN may show a compact summary of its interpretation.

The summary should include:

- interpreted objective;
- task type;
- key constraints;
- expected deliverable;
- freshness requirement;
- risk level;
- missing assumptions;
- whether external actions are included.

The user shall be able to correct material misunderstandings before paid or consequential execution.

## 8. Execution Plan Preview

### 8.1 Required Information

The recommended plan shall show:

- plan name;
- execution mode;
- major roles;
- expected result type;
- estimated completion time;
- predicted quality;
- prediction confidence;
- minimum, expected, and maximum cost;
- approval requirements;
- material data disclosures;
- planned external actions;
- major limitations.

### 8.2 Provider Presentation

The default view shall describe roles first.

Example:

```text
Research Lead
Technical Reviewer
Evidence Verifier
Final Editor
```

Provider and model names may appear in an expandable section titled, for example, "Technical configuration."

### 8.3 Alternatives

The plan preview shall present up to three meaningful alternatives:

- Economy;
- Recommended;
- Premium.

Each alternative shall show the expected change in:

- quality;
- confidence;
- cost;
- latency;
- verification depth;
- number of AI or tool executions.

Alternatives with no meaningful distinction shall not be displayed.

### 8.4 Recommended Plan

The Recommended plan shall be visually primary.

Its selection rationale shall be expressed in outcome terms, such as:

> Meets the required quality threshold with independent review at a lower expected cost than the premium plan.

The rationale shall not rely on provider popularity.

## 9. Approval Experience

### 9.1 Approval Categories

The interface shall distinguish:

- Cost Approval;
- Data Approval;
- Action Approval;
- Scope Approval.

One approval category shall not imply another.

### 9.2 Approval Card

Every approval request shall state:

- what will happen;
- why it is needed;
- who or what receives data;
- estimated cost exposure;
- maximum cost exposure;
- affected resources;
- reversibility;
- expiration;
- whether the approval covers one action or a bounded series;
- what happens if the user declines.

### 9.3 Consequential Actions

For email, publishing, purchasing, payment, contract acceptance, deletion, production changes, account changes, or similar actions, the approval interface shall show the exact proposed action before execution.

Where applicable, the user shall see:

- recipient;
- destination;
- content preview;
- amount;
- resource identifier;
- environment;
- deletion scope;
- rollback availability.

### 9.4 Approval Controls

Controls shall use explicit verbs, such as:

- Approve and Run;
- Approve This Action;
- Approve Up to ¥X;
- Reject;
- Edit Plan;
- Remove External Action.

Ambiguous controls such as "OK" shall not be used for consequential approval.

### 9.5 Material Plan Change

If execution changes beyond the approved cost, data, action, or scope boundary, the interface shall pause and request renewed approval.

## 10. Progress Presentation

### 10.1 User-Centered Progress

Progress shall be described as work stages rather than token generation or raw provider calls.

Preferred labels include:

- Understanding the request;
- Gathering evidence;
- Comparing options;
- Reviewing claims;
- Resolving disagreements;
- Preparing the final result.

### 10.2 Progress Detail Levels

The default progress view shall show:

- current stage;
- completed stages;
- estimated remaining time;
- current expected cost range;
- whether user input is required.

An expanded progress view may show:

- role executions;
- tool calls;
- retries;
- fallback events;
- evaluation stages;
- cost consumed;
- execution graph state.

### 10.3 Long-Running Work

For long-running missions, the interface shall provide:

- checkpoints;
- intermediate deliverables;
- updated cost forecasts;
- pause and cancel controls;
- approval requests at bounded transitions;
- a clear indication of autonomous work remaining.

### 10.4 Cancellation

Cancellation shall indicate:

- whether active work stopped;
- whether external actions had already occurred;
- cost already incurred;
- partial outputs retained;
- whether the mission can resume.

## 11. Result Workspace

### 11.1 Default Information Hierarchy

The default result order shall be:

1. Conclusion;
2. Recommended Actions;
3. Key Reasoning;
4. Evidence;
5. Uncertainty and Limitations;
6. Cost and Execution Summary;
7. Expandable Technical Detail.

### 11.2 Conclusion

The conclusion shall answer the user's main question directly.

It shall not begin with execution narration, provider descriptions, or generic disclaimers.

### 11.3 Recommended Actions

Recommended actions shall be:

- prioritized;
- concrete;
- bounded;
- linked to supporting reasoning;
- marked when approval is required;
- marked when confidence is low.

### 11.4 Key Reasoning

Key reasoning shall explain the decisive factors without exposing hidden chain-of-thought.

The system may show:

- assumptions;
- criteria;
- evidence considered;
- alternatives rejected;
- material disagreements;
- synthesized rationale.

It shall not claim to expose private internal reasoning traces.

### 11.5 Result Status

Every result shall have one of these statuses:

- Complete;
- Complete with Limitations;
- Partial;
- Blocked Pending Approval;
- Blocked by Policy;
- Failed.

The status shall be accompanied by a user-centered explanation.

## 12. Task-Specific Result Layouts

### 12.1 Research

Research results should include:

- executive conclusion;
- key findings;
- source-backed claims;
- disagreements or evidence gaps;
- freshness date;
- recommendations;
- bibliography or source list;
- confidence by major finding.

### 12.2 Coding

Coding results should include:

- implementation summary;
- files changed;
- relevant code or patch;
- test results;
- known limitations;
- security or compatibility risks;
- deployment or rollback notes;
- unresolved questions.

### 12.3 Comparison

Comparison results should include:

- recommended option;
- decision criteria;
- weighted comparison;
- trade-offs;
- sensitivity to changed assumptions;
- cost implications;
- alternatives.

### 12.4 Decision Support

Decision-support results should include:

- decision statement;
- recommended choice;
- assumptions;
- risks;
- expected outcomes;
- reversible and irreversible elements;
- trigger conditions for reconsideration.

### 12.5 Writing

Writing results should include:

- final artifact first;
- audience and tone summary where useful;
- editable alternatives only when materially distinct;
- factual claims requiring verification;
- unresolved placeholders.

### 12.6 Autonomous Execution

Autonomous-execution results should include:

- objective achieved or not achieved;
- actions taken;
- actions not taken;
- approvals used;
- changed resources;
- produced artifacts;
- cost and elapsed time;
- rollback information;
- remaining work.

## 13. Evidence Presentation

### 13.1 Claim-Level Evidence

Material factual claims shall be linked to supporting evidence where available.

Evidence presentation may use:

- inline citations;
- source badges;
- evidence drawers;
- expandable claim cards;
- code references;
- test reports;
- tool-output references.

### 13.2 Evidence Quality

The interface shall distinguish, where material:

- primary source;
- official documentation;
- peer-reviewed source;
- reputable secondary source;
- user-provided source;
- model-generated inference;
- unsupported assertion.

### 13.3 Freshness

Time-sensitive evidence shall show:

- publication or retrieval date;
- last verification date;
- freshness warning when applicable.

### 13.4 Conflicting Evidence

When reliable evidence conflicts, the result shall not hide the disagreement.

The interface shall show:

- the disputed claim;
- major positions;
- supporting evidence for each;
- the synthesis decision;
- remaining uncertainty.

## 14. Uncertainty and Confidence

### 14.1 Confidence Display

Confidence shall be shown only when it is grounded in evidence, benchmark performance, agreement, verification, or calibration data.

The system shall avoid false numerical precision.

Preferred levels are:

- High;
- Moderate;
- Low;
- Unknown.

A numeric range may be shown in expert mode when calibrated.

### 14.2 Confidence Scope

Confidence shall be scoped to a claim, finding, recommendation, or result section.

A single global score shall not conceal uneven reliability.

### 14.3 Uncertainty Reasons

The interface should explain uncertainty using reasons such as:

- limited evidence;
- stale evidence;
- conflicting sources;
- weak benchmark coverage;
- new provider or workflow;
- incomplete tool execution;
- unresolved assumptions;
- low agreement between independent reviewers.

### 14.4 Unknowns

Unknown information shall be labeled as unknown rather than filled with plausible text.

## 15. Multi-AI Disagreement Presentation

The default result shall present one synthesized answer.

Disagreement shall be surfaced when it is materially relevant.

The interface may show:

- issue of disagreement;
- positions considered;
- evidence supporting each position;
- evaluator judgment;
- final synthesis;
- residual uncertainty.

Provider names shall not substitute for substantive explanation.

## 16. Cost and Usage Presentation

### 16.1 Before Execution

The interface shall show:

- minimum estimated cost;
- expected cost;
- maximum authorized cost;
- confidence in the estimate;
- cost-driving components;
- free-tier or subscription assumptions.

### 16.2 During Execution

The interface shall show, where useful:

- estimated cost consumed;
- remaining reserved budget;
- updated final estimate;
- warnings when thresholds are approached.

### 16.3 After Execution

The interface shall show:

- estimated cost;
- actual cost;
- variance;
- provider and tool cost breakdown in expert mode;
- unused reservation released;
- reason for material variance.

### 16.4 Zero-Cost Work

Zero-cost or mock execution shall be clearly identified as such.

The interface shall not imply that a mock cost estimate is an actual provider charge.

## 17. Expert Audit View

The expert view shall provide enough detail to reproduce and assess the execution decision without exposing secrets or private hidden reasoning.

It may include:

- request identifier;
- task analysis version;
- policy version;
- benchmark snapshot version;
- pricing snapshot version;
- candidate list;
- exclusion reasons;
- score breakdown;
- role assignments;
- execution graph;
- provider and model identifiers;
- tool invocations;
- retries and fallbacks;
- evaluator results;
- synthesis inputs;
- approvals;
- cost estimate and reconciliation;
- safety events;
- timestamps;
- artifact references.

Secrets, raw credentials, prohibited personal data, and private internal reasoning shall not be displayed.

## 18. Error and Failure UX

### 18.1 Error Principles

Errors shall be:

- specific;
- actionable;
- non-blaming;
- honest about completed work;
- honest about incurred cost;
- clear about whether retrying is safe.

### 18.2 Provider Failure

The user-facing message shall explain the outcome impact rather than only naming the provider error.

Example:

> The independent review could not be completed. The draft answer is available, but confidence is lower than planned.

### 18.3 Partial Completion

Partial results shall include:

- completed sections;
- missing sections;
- reason for incompleteness;
- incurred cost;
- recommended next action;
- whether continuing requires approval.

### 18.4 Policy Block

A policy block shall state:

- what is blocked;
- the governing category;
- whether a safer alternative exists;
- whether user approval can resolve it;
- whether the block is non-overridable.

## 19. History, Reopen, and Reproducibility

Users shall be able to reopen prior work and see:

- original request;
- result version;
- execution date;
- evidence freshness;
- cost;
- approvals;
- artifacts;
- whether the result can be reproduced;
- whether provider or benchmark changes may produce a different outcome.

Re-running shall create a new result version rather than silently replacing the prior result.

## 20. Notifications

Notifications shall be reserved for meaningful state changes, including:

- approval required;
- execution completed;
- execution blocked;
- budget threshold reached;
- long-running checkpoint available;
- consequential action completed or failed;
- material evidence became stale.

Routine internal steps shall not generate noisy notifications.

## 21. Accessibility

The interface shall target WCAG 2.2 AA.

Required considerations include:

- complete keyboard navigation;
- visible focus states;
- semantic headings and landmarks;
- screen-reader labels;
- no color-only status communication;
- sufficient contrast;
- scalable text;
- reduced-motion support;
- accessible tables and charts;
- descriptive error messages;
- accessible approval dialogs;
- captions or text equivalents for media.

## 22. Responsive Behavior

The experience shall work across desktop, tablet, and mobile.

On smaller screens:

- conclusion and actions remain first;
- plan alternatives may become cards;
- audit details collapse;
- tables may become stacked comparisons;
- approval information remains complete;
- destructive or consequential controls remain separated from routine actions.

No required approval detail may be hidden solely because of viewport size.

## 23. Internationalization

The interface shall support:

- localized language;
- local date and time formatting;
- local currency formatting;
- translated status and approval terminology;
- right-to-left layout readiness;
- provider names preserved where required;
- localized legal and privacy notices.

Machine translation shall not alter numeric limits, approval scope, monetary values, or resource identifiers.

## 24. Design System Requirements

### 24.1 Semantic Tokens

The design system shall define semantic tokens for:

- success;
- warning;
- risk;
- blocked;
- uncertainty;
- approval required;
- cost threshold;
- evidence quality;
- active progress;
- inactive progress.

### 24.2 Required Components

The component library should include:

- RequestComposer;
- TaskUnderstandingCard;
- PlanSummaryCard;
- PlanAlternativeCard;
- RoleChip;
- CostEstimate;
- QualityEstimate;
- ConfidenceIndicator;
- ApprovalCard;
- DataDisclosureCard;
- ProposedActionPreview;
- ProgressTimeline;
- ResultSection;
- EvidenceLink;
- ClaimConfidence;
- LimitationNotice;
- PartialResultNotice;
- CostReconciliation;
- AuditTimeline;
- ExecutionGraphView.

### 24.3 Status Language

Status labels shall be consistent across the product.

The same concept shall not appear as "waiting," "paused," and "pending" in different screens unless the states differ semantically.

## 25. Information Density

The default interface shall prioritize concise, decision-relevant information.

Progressive disclosure shall follow three levels:

### Level 1: Outcome

- conclusion;
- actions;
- status;
- cost;
- confidence.

### Level 2: Support

- reasoning summary;
- evidence;
- limitations;
- alternatives;
- major execution details.

### Level 3: Audit

- routing;
- model and provider details;
- benchmark and policy versions;
- execution graph;
- evaluator detail;
- detailed cost records.

## 26. Privacy UX

The user shall be informed when data is:

- sent to an external provider;
- stored beyond the session;
- shared across services;
- used for evaluation;
- used for product improvement;
- redacted or minimized;
- excluded from a provider because of policy.

Privacy information shall be specific to the planned execution rather than limited to a generic global notice.

## 27. Safety UX

Safety warnings shall be proportional and relevant.

The interface shall avoid repetitive generic warnings that users learn to ignore.

High-risk outputs shall clearly distinguish:

- information;
- recommendation;
- professional review requirement;
- prohibited action;
- user decision;
- system-executed action.

## 28. Analytics and UX Quality Metrics

The product shall measure, with appropriate privacy controls:

- request completion rate;
- clarification rate;
- plan acceptance rate;
- approval comprehension failures;
- cancellation rate;
- time to first useful result;
- time to complete result;
- evidence expansion rate;
- audit-view usage;
- result correction rate;
- user-reported usefulness;
- user-reported trust;
- estimate versus actual cost comprehension;
- accessibility defects;
- accidental consequential-action rate.

Metrics shall not optimize engagement at the expense of task completion, cost, safety, or truthfulness.

## 29. Initial Zero-or-Low-Cost Implementation

The first UX increment may use deterministic mock data and synthetic provider profiles.

It shall support:

1. a request composer;
2. task-understanding summary;
3. recommended plan and alternatives;
4. role-first presentation;
5. quality, confidence, latency, and cost estimates;
6. distinct cost, data, action, and scope approvals;
7. a simulated progress timeline;
8. a conclusion-first mock result;
9. evidence and uncertainty sections;
10. partial-result and blocked-result states;
11. cost reconciliation using mock usage;
12. an expert audit view;
13. responsive behavior;
14. keyboard-accessible interactions;
15. no real provider charge or consequential external action.

## 30. Acceptance Criteria

The specification is implemented for the first mock release when:

1. users can submit a request without choosing a provider;
2. the system displays its interpreted objective and constraints;
3. the recommended execution plan is understandable without technical expertise;
4. economy, recommended, and premium plans show meaningful trade-offs;
5. minimum, expected, and maximum cost are visible before execution;
6. approval categories are visually and semantically distinct;
7. consequential actions show an exact preview;
8. material plan changes trigger renewed approval;
9. progress is shown as user-centered work stages;
10. the result begins with a direct conclusion;
11. recommended actions are concrete and prioritized;
12. material claims can display evidence;
13. uncertainty reasons are visible;
14. partial completion is clearly distinguished from success;
15. estimated and mock actual costs are reconciled;
16. the expert audit view exposes routing and execution metadata;
17. private hidden reasoning and secrets are not exposed;
18. keyboard-only operation is possible;
19. mobile layouts preserve required approval detail;
20. no mock screen can accidentally trigger a real external write.

## 31. Representative UX Tests

The initial test suite shall include at least:

1. simple low-risk request with a single free mock model;
2. complex request with reviewed execution;
3. plan alternatives with measurable quality-cost differences;
4. request requiring cost approval;
5. request requiring data approval but not action approval;
6. request requiring exact external-action preview;
7. plan change that invalidates an existing approval;
8. execution with provider fallback;
9. execution that reaches a budget warning;
10. execution stopped by a hard limit;
11. partial result caused by failed review;
12. conflicting evidence surfaced in the result;
13. low-confidence result with specific uncertainty reasons;
14. stale-evidence warning;
15. expert audit inspection;
16. keyboard-only approval flow;
17. screen-reader interpretation of status and cost;
18. mobile consequential-action approval;
19. cancellation after partial cost has been incurred;
20. reopening and rerunning a historical result.

## 32. Non-Goals for the First UX Increment

The first increment does not require:

- live billing;
- broad provider integration;
- real autonomous external actions;
- a marketplace of AI providers;
- user-managed prompt engineering;
- provider-first navigation;
- public community ranking;
- advanced collaborative editing;
- full enterprise administration.

## 33. Fixed UX Decisions

The following decisions remain fixed unless explicitly changed by the product owner:

- Automatic is the default mode.
- Users are not required to choose an AI provider.
- Roles and outcomes are presented before provider identities.
- The default result is conclusion-first.
- Cost is visible before expensive execution.
- Cost, data, action, and scope approvals are independent.
- Consequential actions require explicit, specific preview and approval.
- Material uncertainty and conflicting evidence are not hidden.
- Progressive disclosure separates outcome, support, and audit detail.
- Provider popularity is not presented as proof of quality.
- The final result is the primary unit of user value.
