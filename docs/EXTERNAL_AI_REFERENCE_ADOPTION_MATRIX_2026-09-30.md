# ORIGIN — External AI Reference Adoption Matrix

Date: 2026-09-30 JST

Purpose: preserve the useful parts of Owner-provided Claude / Gemini / Grok / other-AI design and audit material without treating any external AI statement as proof by itself.

Evidence rule: an idea is considered adopted only when the current repository contains the implementation or executable evaluation contract. A prior audit report, chat answer, or design note alone is not implementation evidence.

## 1. Image generation / Creative

| External reference idea | Current ORIGIN state | Evidence / implementation | Remaining work |
| --- | --- | --- | --- |
| Intent Reasoner | Adopted | raster visual request planning + Visual Brain | continue benchmark-driven intent regression |
| Scene Planner / composition planning | Adopted | rasterVisualPlannerV15 + templates + Visual Brain composition | improve from losing blind-benchmark cases |
| Prompt Compiler | Adopted | compiledPrompt / negativePrompt + universal visual spec | tune only on development cases, never held-out answers |
| Provider-agnostic router | Adopted | raster provider registry and explicit capability descriptors | add providers only when exact USD 0 is verified |
| Change / Preserve map | Adopted foundation | Visual Brain changePreserve contract | becomes production-critical when edit/inpaint is activated |
| Visual Memory / Asset Graph | Adopted foundation | IndexedDB raster history, SHA-256 identity, parent lineage | multi-turn editing/variation remains gated |
| Deterministic typography | Adopted foundation | exact-text extraction + typography-safe planning/local overlay path | verify Japanese OCR/text placement in live raster workflow |
| Structural Critic | Adopted | image signature/dimensions/payload checks | retained as hard pre-gate |
| Technical pixel Critic | Adopted | entropy/edge/clipping/information-density checks | retained as hard pre-gate |
| Semantic Vision Critic | Adopted candidate and Production code | Cloudflare Moondream semantic critic, 7 quality axes | delivery gate remains disabled until real free-plan effectiveness/quota evidence |
| Blind quality benchmark | Adopted | 24-case / 8-family evaluator, 3 references, 2 judges, strongest-reference comparison | execute real sealed round after image runtime activation |
| Generate → Critic → Repair → Recheck | Partially adopted | bounded-repair policy exists; critics exist | live raster repair execution is not yet enabled |
| Best-of-N | Deliberately not active | policy recommends 2 for quality-critical cases but activeCandidates=1 | enable only if real free quota + latency evidence supports it |
| OCR / Layout / Fidelity | Partial | deterministic text handling, layout planning, semantic textHandling/subjectIntegrity axes | dedicated OCR/fidelity repair path still required |
| Image editing / inpaint / outpaint / variation | Not live | registry models capability but no verified zero-cost provider ready | later release; preserve/change and identity gates must apply |
| Safety / provenance / asset manager | Adopted foundation | sensitive-input block, server-only secret rule, SHA-256 lineage/provenance | continue output-safety and copyright evaluation |

## 2. Coding / Claude-Code-class target

| External reference idea | Current ORIGIN state | Evidence / implementation | Remaining work |
| --- | --- | --- | --- |
| Repository understanding before editing | Adopted | repository explorer/navigator and bounded discovery | deepen symbol/import/caller navigation only from benchmark evidence |
| Multi-file editing | Adopted | Agentic Coding session supports bounded multi-file scope | validate on fresh held-out tasks |
| Verify before completion | Adopted | typecheck/lint/test/build verification and completion gate | keep false-completion as hard failure |
| Failure → repair → reverify | Adopted | bounded repair rounds / recovery evidence | compare recovery success against reference coding agents |
| Hidden tests | Adopted evaluator boundary | private held-out runner materializes hidden tests after agent session | run fresh unseen corpus |
| Same base SHA / time budget | Adopted benchmark contract | held-out coding scorer | keep all failures/quota blocks in denominator |
| No accidental Git/deploy | Adopted safety boundary | publication/deploy separate from coding verification | automatic publication remains a separately approved capability |
| Claude Code parity/superiority claim | Not proven | explicit parity gate exists | requires controlled identical-task comparison; do not claim before evidence |

## 3. Answer quality / response quality

| External reference idea | Current ORIGIN state | Evidence / implementation | Remaining work |
| --- | --- | --- | --- |
| Correctness + intent fit + completeness | Adopted evaluator | AQ V2 | run fresh exact-SHA live evidence |
| Structure / clarity / density / actionability | Adopted evaluator | AQ V2 scored axes | improve based on losing families |
| Mobile and desktop readability | Adopted evaluator | 390px + 1440px evidence contract | retain exact-SHA rendered evidence |
| Evidence / citation usefulness | Adopted | AQ V2 + Grounded Research evidence contracts | fresh blind comparison still required |
| 48-case frozen corpus | Adopted contract | AQ V2 sealed corpus shape | no reuse of consumed one-shot evidence |
| Anonymous A/B competitive judging | Adopted contract | >=3 references, >=2 independent judges | execute fresh sealed round |
| No marketing claim without proof | Adopted | world-class quality gate | keep status “not proven” until exact-SHA evidence passes |

## 4. General Agent

| External reference idea | Current ORIGIN state | Evidence / implementation | Remaining work |
| --- | --- | --- | --- |
| Supervisor / Planner | Adopted foundation | Agent orchestrator planning/task graph | measure with held-out tasks |
| Tool routing | Adopted foundation | Tool Registry + Permission Gate | compare tool-choice correctness |
| Verification | Adopted | artifact/completion verification | include in every held-out run |
| Approval boundary | Adopted | authenticated one-time approval | benchmark bypass attempts |
| Checkpoint / Recovery | Adopted foundation | checkpoint, rollback, resume, self-fix | benchmark at least 3 recovery tasks |
| Stop / Cancel / timeout | Adopted foundation | AgentRunSession + cancellation/deadline state | benchmark at least 2 stop/cancel tasks |
| 12-task strong-agent comparison | Added in this candidate | heldOutGeneralAgentBenchmarkV2 scorer + CLI | build evaluator-owned private corpus and trusted runner |
| False completion / unapproved writes counted as failure | Added in this candidate | safety axis in held-out Agent scorer | retain in every comparison round |

## 5. UI / UX guidance previously supplied by external audits

The useful design principles remain binding:
- simple front surface, powerful internal execution;
- avoid dashboard/SaaS visual overload;
- one clear composer and consistent send behavior;
- mobile-first 320/375/390px safety;
- visible controls must work;
- no oversized framing around small text;
- artifact actions must have truthful behavior;
- touch targets must remain usable;
- fake progress / fake ETA is prohibited.

Several historical blockers were already corrected in later releases (mobile add-menu dismissal, Artifact Edit behavior, header/control simplification, tap-target regressions). These historical fixes are not proof that current Production is visually perfect; current exact-SHA browser audits remain required.

## 6. Security / cost guidance from Claude / Gemini / Grok audits

Adopted permanent controls:
- USD 0 / free-only;
- no paid fallback;
- no credit-card-required fallback;
- server-only secrets;
- fail closed on unverified plan/cost/quota;
- no silent provider switching;
- evidence-first status language;
- exact main / Production SHA verification;
- approval boundaries for high-impact external actions.

The benchmark score is never allowed to weaken these controls.

## 7. Current gaps to prioritize

P0 / active:
1. activate real free raster generation only after server-only Cloudflare credentials and Free-plan proof;
2. wire Semantic Vision Critic only after live free-quota/effectiveness evidence;
3. execute real image E2E and then the sealed 24-case image benchmark.

P1:
1. complete trusted 12+ task General Agent benchmark execution path;
2. run fresh AQ V2 exact-SHA evidence;
3. run fresh held-out Coding comparison evidence.

P2:
1. bounded raster Generate → Critic → Repair → Recheck;
2. OCR / identity-fidelity / layout repair;
3. image editing/inpaint/outpaint/variation only with verified zero-cost provider;
4. artifact blind-comparison benchmark.

## 8. Rule for future external-AI material

When the Owner supplies another AI's audit or design proposal:
1. preserve the exact useful finding;
2. verify it against current source/Production evidence;
3. classify it as already adopted / useful gap / obsolete / conflicting with permanent constraints;
4. implement useful gaps behind tests;
5. bind performance claims to controlled evidence;
6. never weaken USD 0, fail-closed, secret, approval, or evidence rules merely because another AI recommends it.
