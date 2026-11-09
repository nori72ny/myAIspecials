# ORIGIN Answer Response Policy V1

Status: design-only candidate. Do not merge runtime behavior changes before the post-#826/#827 AQ baseline is captured.

## Goal

Create a task-aware response-policy layer that improves clarity, structure, tone fit, brevity/depth calibration, evidence placement, and mobile readability without weakening correctness, grounding, safety, tool truthfulness, cost controls, or explicit user formatting requests.

## Permanent separation

ORIGIN treats answer quality as four independent but coordinated layers:

1. semantic correctness and task completion;
2. response policy / structural presentation intent;
3. language realization / tone;
4. UI typography and rendering.

A better-looking answer must never compensate for a factually wrong, unsupported, unsafe, incomplete, or falsely tool-claimed answer.

## Integration point

The response policy should consume the existing request analysis rather than duplicate it.

Primary upstream inputs:
- `OriginRequestIntent.primaryTask`;
- `OriginRequestIntent.interactionMode`;
- required capabilities;
- requested/suggested outputs;
- recent conversation context from the bounded context policy;
- explicit user formatting instructions;
- execution evidence flags for search/tools/artifacts/citations.

Recommended new bounded module:
- `src/lib/orchestration/OriginResponsePolicy.ts`
- `src/lib/orchestration/OriginResponsePolicy.test.ts`

The policy must return declarative presentation intent. It should not execute tools, alter provider selection, fabricate citations, or directly mutate UI.

## Proposed contract

```ts
export type OriginAnswerDepth = "brief" | "standard" | "deep";
export type OriginAnswerVoice = "conversational" | "neutral" | "report" | "deliverable";
export type OriginStructureMode =
  | "answer-first"
  | "explanation"
  | "procedure"
  | "comparison"
  | "research"
  | "technical-debug"
  | "decision-support"
  | "creative"
  | "finished-artifact";

export interface OriginResponsePolicy {
  version: 1;
  depth: OriginAnswerDepth;
  voice: OriginAnswerVoice;
  structure: OriginStructureMode;
  answerFirst: boolean;
  allowHeadings: boolean;
  preferParagraphs: boolean;
  allowBullets: boolean;
  allowNumberedSteps: boolean;
  allowTable: boolean;
  allowCodeBlock: boolean;
  preserveRequestedFormat: boolean;
  evidencePlacement: "inline-near-claim" | "not-applicable";
  uncertaintyStyle: "explicit-when-material";
  mobileScanability: true;
}
```

The concrete implementation may differ, but the semantic separation and fail-closed invariants must remain.

## Selection rules

### 1. Direct answer by default

Avoid empty meta-openers such as “I will explain” or repeating the user’s question. When the answer can be stated immediately, lead with it.

Exceptions are limited to cases where safety, uncertainty, missing prerequisites, or a required artifact handoff materially changes what the user needs to know first.

### 2. Depth calibration

Brief:
- simple factual answer;
- confirmation;
- narrow definition;
- straightforward follow-up.

Standard:
- ordinary explanation;
- practical recommendation with reasons;
- moderate comparison;
- most business questions.

Deep:
- research;
- architecture;
- technical debugging;
- multi-factor decisions;
- legal/scientific/financial context where nuance is required;
- user explicitly asks for detail or comprehensiveness.

Do not impose arbitrary character limits. Optimize for sufficient information with low redundancy.

### 3. Structure by task

Short factual question:
- answer -> one useful clarification if needed.

Explanation:
- answer -> definition/context -> example -> material caveat.

Procedure:
- goal/prerequisite when needed -> numbered steps -> failure/recovery note.

Comparison:
- neutral framing -> comparison dimensions -> table only when columns improve comprehension -> tradeoffs.

Research:
- concise finding -> evidence near the supported claim -> uncertainty/gaps -> implications.

Technical/code:
- observed issue -> likely/confirmed cause -> change -> verification.

Decision support:
- decision factors -> options/tradeoffs -> risks/constraints; do not substitute ORIGIN’s preference for the user’s decision.

Creative/writing:
- prioritize the finished content; avoid analytical scaffolding unless asked.

Finished artifact:
- deliver the artifact in the requested format first; explanation is secondary.

### 4. Lists and tables are conditional

Use bullets only for genuinely parallel items. Use numbered lists only when order matters. Use tables only when row/column comparison reduces cognitive load.

Avoid:
- turning every paragraph into a bullet;
- one-sentence bullets that merely fragment normal prose;
- tables for two trivial facts;
- large tables that become unusable on 390px mobile.

### 5. Tone and user adaptation

Match language and reasonable formality to the user and task.

Technical/business work:
- concise;
- specific;
- low-emotion;
- concrete conditions and evidence.

Open-ended discussion:
- natural conversational prose;
- restrained structure.

Emotionally sensitive discussion:
- acknowledge the material concern without canned reassurance;
- remain factual and non-patronizing.

Expert user:
- preserve domain terminology unless ambiguity requires definition.

Beginner:
- explain necessary terms and use examples without oversimplifying the conclusion.

### 6. Candor

When something is wrong, unsupported, unavailable, or risky, say so clearly and constructively. Avoid vague softening that obscures the factual conclusion.

### 7. Specificity

Prefer concrete facts, dates, thresholds, steps, examples, and conditions over empty intensifiers such as “very popular,” “extremely effective,” or “overwhelmingly good.”

### 8. Evidence and uncertainty

When evidence exists, keep citations/source references adjacent to the claims they support. Never detach citations into a generic source dump when claim-level placement is available.

Material uncertainty must be explicit. Distinguish:
- verified fact;
- reasonable inference;
- recommendation;
- unknown/not measured.

### 9. Explicit user formatting wins

If the user requests “no bullets,” “table only,” “500 characters,” “email format,” “Excel-copyable,” or another concrete format, preserve that request unless safety or technical impossibility prevents it.

## Anti-pattern gates

Regression tests should cover at minimum:
- unnecessary preamble;
- repeating the user’s question;
- over-sectioning;
- list spam;
- table abuse;
- excessive bold;
- repeated conclusion;
- excessive verbosity on simple prompts;
- shallow answers on complex prompts;
- generic intensifiers instead of specifics;
- awkward literal Japanese;
- unsupported certainty;
- evidence separated from claims;
- requested-format violations.

## Typography boundary

Actual font family, font size, line-height, spacing, code-block chrome, table overflow, and citation styling remain UI responsibilities.

Current source already defines a Japanese-capable system font stack and a 16px / 1.75 body baseline. Any future typography change must be evaluated separately from response-policy changes so semantic and rendering effects are not confounded.

## Evaluation sequence

1. Capture one valid post-#826/#827 current-main AQ baseline before runtime response-policy changes.
2. Freeze the comparable prompt/evidence set permitted by the benchmark contract.
3. Implement `OriginResponsePolicy` behind deterministic unit coverage.
4. Run semantic/task AQ unchanged.
5. Run a separate blinded Answer UX benchmark on before/after outputs.
6. Inspect representative Japanese outputs at desktop and 390px mobile.
7. Reject the change if presentation improves while factuality, grounding, tool truthfulness, task success, safety, or artifact/coding behavior regresses.

## Answer UX scoring dimensions

Keep these independent from semantic correctness scoring:
- directness;
- structure fit;
- depth calibration;
- completeness without redundancy;
- tone fit;
- Japanese naturalness;
- mobile scanability;
- copy/paste usability;
- evidence placement;
- uncertainty phrasing;
- adherence to explicit formatting.

## External AI material rule

Owner-supplied descriptions of other AI systems are reference input, not proof. Translate useful observations into provider-neutral principles, verify them against ORIGIN’s current implementation, implement behind tests, and measure before/after. Do not hard-code named competitor imitation.

## Current release gate

This document may be reviewed before the AQ baseline. Runtime changes to user-facing answer behavior should remain unmerged until the baseline is captured, unless a separate correctness/security blocker requires an immediate fix.
