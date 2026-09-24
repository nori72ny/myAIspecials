# ORIGIN Personal — Independent Comparative Product Audit Request

Date: 2026-09-25  
Target repository: `nori72ny/myAIspecials`  
Canonical production: `https://origin-personal.vercel.app`

## 1. Your role

Act as an independent Principal Product Engineer, AI Architect, Security Engineer, SRE, Product Designer, UX Researcher, Accessibility Reviewer, Agent/Coding Evaluator, and Red-Team reviewer.

Do **not** assume ORIGIN is good because its developers say so. Do not give ORIGIN preferential treatment. Verify claims from code, production behavior, CI evidence, screenshots, network/runtime behavior, and reproducible tests wherever possible.

You may compare ORIGIN with your own product/model and with current leading products such as ChatGPT / ChatGPT Work, Claude / Claude Code, Gemini, Perplexity, and Manus. When a competitor capability cannot be independently verified, label it as unverified rather than guessing.

## 2. ORIGIN's intended goal

ORIGIN Personal aims to become a world-class personal AI OS / AI Agent with:
- a simple, calm user interface while doing sophisticated work behind the scenes;
- grounded research with citations and conflict handling;
- practical artifact creation rather than text-only answers;
- Web/Application Builder capabilities;
- agentic coding at or above leading coding-agent experiences;
- strong mobile and desktop UX;
- local-first / privacy-preserving behavior where practical;
- a strict zero-cost operating boundary for the current release;
- no automatic paid fallback;
- fail-closed security behavior;
- server-only secret delivery;
- owner approval boundaries for privileged/publication actions;
- continuous, evidence-driven improvement without silently weakening safety.

The audit is not to confirm this aspiration. The audit is to determine how much of it is actually true today.

## 3. Evidence rules

Use primary evidence whenever possible:
1. current default branch `main`;
2. exact commit SHA deployed to canonical Production;
3. GitHub Actions job details, not only badges;
4. production `/api/health`;
5. production runtime errors;
6. real browser interaction on desktop and mobile;
7. exact UI screenshots/video where available;
8. network requests, headers, CSP, service-worker behavior;
9. unit/E2E/Lighthouse/accessibility/security tests;
10. reproducible prompts and exact outputs for answer-quality comparisons.

Do not treat documentation, issue comments, or prior AI reports as proof by themselves.

## 4. Required product walkthrough

Test the product as a first-time user and as an expert user.

### Home / conversation
Check:
- first visual impression;
- clarity of what to do;
- composer size and usability;
- + menu;
- file attachment entry;
- Research / Code / Create entry points;
- History;
- Settings;
- send/stop behavior;
- keyboard behavior;
- mobile keyboard interaction;
- screen overflow and safe areas;
- visual consistency.

### Research
Check:
- navigation from Home and direct URL;
- loading, empty, error, success states;
- source links;
- source safety;
- citation usefulness;
- current-fact handling;
- conflicts and uncertainty;
- return-to-chat behavior;
- mobile and desktop design quality.

### Code
Check:
- navigation from Home and direct URL;
- authorization/setup state;
- request form;
- evidence/status presentation;
- exact-repo/SHA boundaries;
- verification contract;
- Git/publication separation;
- mobile/desktop usability;
- comparison with strong coding-agent workflows.

### Create
Check:
- navigation from Home and direct URL;
- title/body controls;
- advanced settings;
- verified local generation;
- history;
- SVG/PNG flow;
- preview quality;
- mobile/desktop design consistency.

### Artifact workspace
Check every visible primary control:
- Code / Preview;
- 375px / 768px / 100%;
- Edit;
- Share;
- Save;
- Details;
- Copy;
- export formats;
- package save;
- restore/revision controls if present;
- presentation/fullscreen if present;
- close/back behavior.

Confirm all visible controls stay inside the viewport at 320/375/390/768/desktop widths.

Inspect generated HTML/Web UI artifacts for:
- minimum touch target sizes;
- input size;
- typography;
- spacing;
- responsive behavior;
- visual hierarchy;
- “raw HTML / prototype” appearance versus production-ready appearance.

### Settings / History / secondary surfaces
Check:
- open/close;
- scrolling;
- all visible buttons;
- links;
- dialogs;
- focus behavior;
- mobile viewport bounds;
- visual consistency with the Home surface.

## 5. Complete interaction audit

For every visible button, link, tab, summary, and primary interactive control on the major surfaces:
- confirm it has an understandable accessible name;
- confirm clicking/tapping it causes the intended result;
- confirm enabled/disabled state is truthful;
- confirm it does not lead to a blank, broken, unauthorized, or visually unfinished page;
- confirm external links are safe and intentional;
- confirm no horizontal clipping;
- confirm mobile touch size is appropriate;
- record broken or misleading controls individually.

Do not sample only a few buttons and call the interaction audit complete.

## 6. Visual-quality comparison

Compare ORIGIN's visual/interaction quality with strong contemporary AI products. Evaluate:
- simplicity;
- hierarchy;
- spacing;
- typography;
- density;
- discoverability;
- responsive behavior;
- perceived polish;
- transition quality;
- empty/loading/error states;
- mobile-first quality;
- artifact/canvas/workspace quality;
- consistency across secondary pages;
- whether the product feels like one coherent system rather than multiple stitched-together tools.

For each category, provide:
- ORIGIN evidence;
- competitor/reference observation;
- where ORIGIN is stronger;
- where ORIGIN is weaker;
- exact improvement recommendation.

Avoid vague statements such as “looks modern.” Point to concrete UI behavior.

## 7. AI capability comparison

Use the same prompts/tasks across products wherever possible.

Compare:
- general answer quality;
- instruction following;
- long-form reasoning quality;
- grounded research;
- citation correctness;
- uncertainty handling;
- synthesis across conflicting evidence;
- document/artifact creation;
- web/app creation;
- coding-agent execution;
- repository understanding;
- multi-file changes;
- testing/verification;
- repair after failure;
- tool use;
- long-running agent behavior;
- privacy/security boundaries;
- cost transparency.

Separate:
1. model intelligence;
2. product UX;
3. tool/agent capability;
4. evidence/verification quality.

Do not let a strong underlying model hide a weak product workflow, or vice versa.

## 8. “Is ORIGIN better than you?” test

Answer this explicitly but evidence-first.

For your own product/model:
- list tasks where ORIGIN demonstrably performs better;
- list tasks where your product/model demonstrably performs better;
- list tasks where evidence is insufficient;
- identify whether ORIGIN's advantage comes from model quality, workflow design, UI, tool integration, security constraints, or another cause.

Then compare ORIGIN against ChatGPT/Work, Claude/Claude Code, Gemini, Perplexity, and Manus in the same way.

Do not give a flattering answer simply because the request asks whether ORIGIN is better.

## 9. Benchmark tasks

At minimum, run or evaluate equivalent tasks in these families:
- current factual research with citations;
- conflicting-source research;
- long-context synthesis;
- practical business document;
- spreadsheet/data task;
- slide/presentation task if supported;
- responsive landing page;
- small interactive web app;
- repository bug fix;
- multi-file refactor;
- test failure diagnosis and repair;
- security-sensitive coding change;
- mobile UI repair;
- artifact revision/editing;
- failure/recovery scenario.

For every task record:
- exact prompt;
- product/model/version when known;
- tool permissions;
- elapsed time if measurable;
- result;
- verification method;
- failures/limitations.

## 10. Security and cost boundaries

Verify, do not assume:
- current Production SHA equals intended main;
- `costUsd=0`;
- `freeOnly=true`;
- paid fallback disabled;
- no hidden provider retry that violates the release policy;
- secrets remain server-side;
- sensitive data is not exposed in client bundles/logs;
- artifact sandbox isolation remains intact;
- no unsafe publication side effect from coding verification;
- PWA/service-worker update behavior does not serve stale unsafe code indefinitely.

Any security or billing uncertainty is a separate finding.

## 11. Required output

Return the report in this exact structure:

### A. Executive summary
A concise description of current product maturity, without marketing language.

### B. Evidence verified
Exact SHAs, production state, tests, browser checks, and other primary evidence.

### C. Broken or incomplete interactions
One row per concrete problem:
- surface;
- control/action;
- expected;
- actual;
- severity;
- evidence;
- proposed fix.

### D. Visual/UX comparison
Compare Home, Research, Code, Create, Artifact, Settings/History, mobile, and desktop.

### E. Capability comparison
Compare answer quality, research, artifacts, builder, coding, agent behavior, security, and cost boundaries.

### F. Where ORIGIN is stronger
Only evidence-supported advantages.

### G. Where ORIGIN is weaker
Only evidence-supported disadvantages.

### H. What is still missing
Capabilities or product qualities that prevent ORIGIN from matching or exceeding the strongest alternatives.

### I. Improvement plan
Prioritize:
- P0: release blocker;
- P1: high-value near-term;
- P2: important quality/capability gap;
- P3: later improvement.

For each item give:
- problem;
- user impact;
- proposed implementation;
- acceptance test;
- regression risk.

### J. Comparative conclusion
State:
- areas where ORIGIN currently exceeds specific alternatives;
- areas where it does not;
- areas where comparison is inconclusive;
- what evidence would be needed to change the conclusion.

## 12. Strict audit behavior

- Do not claim a test passed unless you ran it or inspected trustworthy exact-run evidence.
- Do not call an unverified feature complete.
- Do not infer production behavior only from source code.
- Do not weaken tests to make ORIGIN look better.
- Do not hide defects because they are small.
- Do not reward feature count over reliability and coherence.
- Treat “simple interface, excellent execution” as a core design requirement.
- Distinguish product aspiration from present reality.
