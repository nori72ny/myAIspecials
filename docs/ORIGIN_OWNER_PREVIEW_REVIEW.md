# ORIGIN Owner Preview Review

Status: Review package prepared from existing evidence  
Product candidate: Personal-use v0.1  
Runtime changes in this document: None

## 1. Evidence Reviewed

### Current baseline

- Repository base: `main`
- Base commit used by the stacked product-quality work: `aea2f41a775bab17b7d72e5d68d7bbaaf6716dd6`
- Current delegation-panel evidence: `delegation-planner-desktop.png`, `sprint-8-3-mobile.png`, `sprint-8-3-dark.png`

### V2 candidate

- PR: #40
- Branch: `sprint-8-4/world-class-product-quality`
- Exact reviewed commit: `50d20678bd7cb237dc781cf0c07ca46e7f315ba4`
- Production workflow run: `29562761725`
- Playwright artifact: `playwright-report-node-22.x`, artifact ID `8399967179`
- Workflow conclusion: successful

Reviewed V2 evidence:

- desktop: 1440 × 900;
- tablet portrait: 834 × 1112;
- tablet landscape: 1194 × 834;
- mobile: 390 × 844;
- mobile lower actions: 390 × 844;
- narrow mobile: 320 × 568 and 375 × 667;
- large-phone landscape: 844 × 390;
- laptop: 1280 × 720;
- full HD: 1920 × 1080;
- 200% zoom-equivalent CSS viewport: 640 × 720;
- reduced-motion condition.

This evidence proves the tested commit rendered and passed its automated journeys. It does not constitute owner acceptance of the design.

## 2. What Changed From the Current Panel

### 2.1 Provider-neutral Japanese presentation

Current panel:

- shows names such as `AI Studio Primary`, `Security Review Assistant`, and `External Review Assistant`;
- shows raw task identifiers such as `implementation` or `security`;
- mixes Japanese explanation with internal English naming.

V2:

- presents role-based labels such as `セキュリティレビュー担当AI`;
- presents task categories such as `セキュリティ確認`;
- explains the independent verifier in Japanese;
- keeps provider or internal implementation identifiers out of the normal summary.

Review: **clear improvement**. This better matches the original provider-neutral requirement and reduces technical vocabulary exposed to the owner.

### 2.2 Information hierarchy

Current panel:

- shows the selected AI as the largest result;
- places task type and verifier in smaller cards;
- provides a technical copied instruction immediately below;
- gives limited explanation of why separate verification is useful.

V2:

- leads with `おすすめの担当`;
- explains why the task was classified that way;
- separates `依頼の種類` and `結果の確認方法`;
- explains the independent-review relationship;
- keeps the copyable instruction below the decision summary.

Review: **improved comprehension**, especially for first-time use.

### 2.3 Layout and responsive behavior

V2 remains within the tested viewport widths and does not visibly introduce horizontal clipping in the reviewed evidence. Cards reflow from two columns to one column. The lower copy and audit actions remain reachable in the dedicated mobile-actions evidence.

Review: **technically suitable for preview testing** across the tested sizes.

## 3. What Is Still Not Good Enough for Final Adoption

### 3.1 The flow is still vertically heavy

The mobile experience requires substantial scrolling from request input to:

- recommendation;
- task category;
- verification method;
- technical instruction;
- copy action;
- audit history.

A second, lower-scrolled screenshot is necessary to show completion. This proves reachability, but it also demonstrates that the complete flow is long.

Disposition: **revise after owner use**, not a blocker for preview.

Recommended direction:

- keep the recommendation and verification summary visible first;
- collapse the machine-oriented instruction under `詳細な指示を見る`;
- keep the main next action close to the recommendation;
- avoid showing audit controls until a result has actually been created or recorded.

### 3.2 The instruction remains developer-oriented

The V2 instruction is Japanese-first, but it still exposes fields such as:

- `(role)`;
- `(task_type)`;
- `(goal)`;
- `(selection_reason)`;
- `(cost_policy)`.

These keys are useful when copying to another AI, but they make the visible product feel like an integration console rather than a personal assistant.

Disposition: **retain for machine reliability, reduce visual prominence**.

Recommended direction:

- show a short human summary by default;
- move the structured instruction into an expandable or copy-only detail area;
- preserve the stable keys in copied text, not necessarily in the primary visible experience.

### 3.3 Planning versus execution is not sufficiently explicit

The interface says `担当と確認方法を判定` and presents an assignee. A user may infer that ORIGIN will now execute the task automatically, while the current merged foundation mainly plans, explains, records, and prepares an instruction.

Disposition: **must be clarified before broad use**.

Candidate copy:

- before action: `この依頼に適した進め方を提案`;
- after action: `おすすめの進め方`;
- explicit note: `現在は担当候補と指示を準備します。外部AIへの自動送信は行いません。`

Final wording requires owner approval.

### 3.4 The surrounding Personal Edition is not fully coherent in Japanese

The reviewed desktop background still includes mixed-language labels such as:

- `ACOS Personal`;
- `Dashboard`;
- `Recent Projects`;
- English sample project names;
- `Switch to Enterprise`.

The delegation panel is more localized than the surrounding product. This creates an inconsistent experience.

Disposition: **not a blocker for a private preview**, but it should be included in the personal-use cleanup rather than expanding enterprise features.

### 3.5 The launcher competes with the core experience

The global floating `AI作業振り分け` launcher is available from the Personal Edition. This is useful, but its purpose relative to `統合チャット` is not obvious:

- use chat for a normal request;
- use the launcher to decide how another AI should handle a request;
- copy the result elsewhere.

Disposition: **requires owner workflow validation**.

The owner should decide whether delegation is:

1. a separate advanced tool;
2. a step inside Unified Chat;
3. automatically invoked only for tasks that benefit from specialization or verification.

For the long-term ORIGIN vision, option 3 is the most aligned, but v0.1 may keep the explicit launcher while behavior is validated.

## 4. Design Decision Matrix

| Area | Current panel | V2 candidate | Review disposition |
|---|---|---|---|
| Japanese clarity | Mixed Japanese and English internals | Japanese-first role and task language | Prefer V2 |
| Provider neutrality | Internal names visible | Internal identifiers hidden in normal summary | Prefer V2 |
| Selection explanation | Short and generic | Request-category-specific explanation | Prefer V2 |
| Verification explanation | Verifier name mainly shown | Independent verification explained | Prefer V2 |
| Mobile width | Works at tested width | Works across broader tested matrix | Prefer V2 |
| Mobile length | Long | Still long, with better hierarchy | Preview, then simplify |
| Copied instruction | Technical | Better localized but still technical | Keep, visually de-emphasize |
| Execution clarity | Can imply delegation/execution | Still can imply execution | Revise wording |
| Overall visual maturity | Functional | More coherent and polished | Prefer V2 for hands-on trial |

## 5. Recommended Owner Preview Candidate

For owner testing, the recommended candidate is:

- PR #38 safety and browser-resilience behavior;
- PR #40 V2 delegation interface;
- V2 kept behind the explicit preview switch;
- no PR #41 answer-quality panel in the primary daily flow;
- no enterprise, marketplace, provider-lifecycle, or billing expansion;
- no merge or deployment implied.

The preview should preserve an easy comparison with the current panel until the owner selects a direction.

## 6. Owner Decisions Needed

The owner review should answer only these questions before further implementation:

1. Is `AI作業振り分け` understandable, or should the feature use a simpler name?
2. Should this remain a separate floating tool or become part of Unified Chat?
3. Is the V2 recommendation card clearer than the current selected-AI card?
4. Should the structured instruction be hidden until requested?
5. Is local audit history useful in the first daily-use version?
6. Should provider identities ever be shown, and if so only in technical details?
7. Is the surrounding Personal Edition sufficiently focused, or should enterprise and experimental navigation be hidden for personal use?
8. Is visible answer-quality scoring needed in v0.1, or should it remain an internal quality gate?

## 7. Current Review Decision

- V2 design: **Recommended for owner hands-on preview, not approved as final**
- Current panel: **Retain temporarily as comparison baseline**
- V2 default enablement: **Not authorized**
- PR #38 merge: **Not authorized**
- PR #40 merge: **Not authorized**
- PR #41 visible inclusion: **Deferred**
- Specification expansion: **Paused**
- Deployment: **Not authorized**
- Next step: **Prepare a hands-on owner test checklist and a preview method that does not imply production release**
