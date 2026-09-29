# ORIGIN Artifact Blind Quality Benchmark V1

Status: executable evaluation protocol. This is **not** evidence that ORIGIN already produces better work products than leading AI systems.

Schema: `origin.artifact-blind-benchmark.v1`.

## Purpose

A file existing is not enough. ORIGIN must produce work products that are correct, complete, usable, editable, visually coherent, and fit for the user's actual task.

This benchmark supplies the missing artifact-domain evidence for `origin.world-class-quality-gate.v1`.

## Frozen shape

Exactly 16 sealed tasks: 8 families × 2 tasks.

Families:
- DOCX business document
- XLSX analysis
- PPTX presentation
- PDF report
- Web landing page
- Web interactive app
- data/report output
- revision/editability workflow

Every official round must cover each challenge tag at least twice:
- precision
- layout
- formulas/data
- charts/visualization
- multilingual
- editability
- responsive behavior
- executive usability

Prompts and expected checks are frozen outside participant-visible source.

## Equal-task rule

ORIGIN and the same 3 frozen reference system/version identities receive the same prompt, inputs, output-format requirement, permissions, and execution budget.

Failed, blocked, quota-limited, corrupt, or over-budget attempts stay in the evidence packet. They are not silently retried until a favorable artifact appears.

## Deterministic pre-qualification

Every compared output must pass:
- format validity;
- successful open/parse;
- required-content validation;
- task-specific deterministic checks;
- corruption checks;
- safe-delivery checks;
- editability validation;
- responsive/layout validation where applicable.

Examples include:
- spreadsheet formulas and numeric cell types;
- slide/page count and required sections;
- DOCX/PPTX editability;
- PDF rendering/content checks;
- HTML/Web-App interaction and responsive checks;
- no overflow, clipping, or broken assets.

A technically invalid comparison set fails closed before subjective judging.

## Blind review

Each case has 1 ORIGIN output + 3 reference outputs. Outputs are assigned opaque keys and judges never see product/system identity.

At least 2 independent judges score every output from 0–4 on:
1. correctness
2. completeness
3. information design
4. aesthetics
5. editability
6. task fit
7. immediate usability

Each judge also records a blind first choice.

ORIGIN is compared against the strongest reference on each case, not the average reference.

## Absolute floor

ORIGIN must meet:
- overall mean >= 3.40
- correctness >= 3.50
- completeness >= 3.40
- information design >= 3.30
- aesthetics >= 3.20
- editability >= 3.30
- task fit >= 3.40
- immediate usability >= 3.40
- zero critical failures

## Competitive acceptance

The round passes only if:
- exactly 16 cases;
- exactly 2 cases per family;
- all challenge tags appear at least twice;
- the same 3 references appear in every case;
- >=2 independent judges;
- all compared outputs pass deterministic validation;
- overall win rate >=50%;
- loss rate <=30%;
- non-loss rate >=60%;
- each family has >=50% non-loss;
- no rubric axis has a negative round mean versus per-case strongest references;
- exact candidate SHA, evaluator SHA, sealed corpus SHA-256 and complete evidence digest are retained;
- evidence is current and expires within 31 days.

## Executable scorer

```sh
npm run eval:artifact-blind-quality -- <evidence.json>
```

The scorer emits `worldClassEvidence` compatible with the artifact domain of:

```sh
npm run eval:world-class-quality -- <evidence.json>
```

## Improvement loop

A failed task is categorized into correctness, completeness, structure, aesthetics, editability, task fit, or usability. Improvements are made on non-held-out development cases, regression tests are added, then a fresh unseen sealed round is run.

Do not lower the benchmark because ORIGIN loses. Improve the work product.

## Safety

No benchmark score can weaken:
- $0/free-only execution;
- paid fallback disabled;
- server-only secrets;
- fail-closed external execution;
- artifact isolation;
- owner approval boundaries.
