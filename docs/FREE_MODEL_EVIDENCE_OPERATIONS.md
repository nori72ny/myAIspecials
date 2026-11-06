# Free-Model Evidence Operations Runbook

How the fixed free-model evidence is verified, refreshed, alerted on, merged,
and deployed — as one routine. This runbook exists because the absence of this
routine caused a real outage; follow it instead of improvising.

Related documents:

- `docs/release/ORIGIN_MANUAL_PRODUCTION_PUBLICATION_GATE_2026-10-09.md` —
  the manual production publication gate this runbook operates inside.
- `.github/workflows/verify-free-model.yml` — the automation described below.
- `scripts/verify-free-model.ts` — the fail-closed pricing verifier.
- `scripts/check-free-model-expiry.sh` — the read-only expiry assessor used
  by the alert step.

## Why this runbook exists (incident summary)

- The production deployment built from `a43e91cb` carried free-model evidence
  with `verifiedAt` 2026-10-20 and `reviewAfter` **2026-10-30T13:40Z**.
- The verify bot kept producing refreshed evidence on
  `automation/free-model-evidence-*` branches (58 branches between
  2026-08-29 and 2026-11-03), but no step in that chain could merge or
  deploy, and **nothing notified anyone**: no workflow in the repository
  opened issues or sent notifications.
- The PR-creation step even converted its own failure into success
  (`::warning::` + `exit 0`), so a refresh could be dropped without any
  visible signal.
- Result: the expired evidence stayed in production and the chat API
  returned `503 FREE_MODEL_EVIDENCE_STALE` for about **7 days**
  (2026-10-30 → 2026-11-06), until a manual evidence refresh
  (PR #1097, merge commit `2792fc7`) was deployed by hand.

Structural fact that makes this routine mandatory: **evidence lives only
10 days** (`reviewDays` window in the verifier). Any human gap longer than
10 days guarantees a recurrence. The routine below keeps the human gap
small and makes every failure loud.

## How the automation works

`Verify free model evidence` (`.github/workflows/verify-free-model.yml`)
runs on schedule `17 0,6,12,18 * * *` (4×/day), on manual dispatch, and on
pushes to the verifier files. Each run:

1. Fetches the official OpenRouter model list and proves the fixed model
   `google/gemma-4-31b-it:free` still reports exactly $0 prompt and $0
   completion pricing. Any doubt (paid, missing, unreachable) **fails the
   run** and production keeps failing closed. There is no paid fallback.
2. If the catalog evidence on `main`
   (`src/lib/orchestration/OriginFreeModelCatalog.ts`) has more than
   3 days of validity left, nothing else happens.
3. Otherwise it refreshes `verifiedAt`/`reviewAfter` (+10 days) and, **only
   if the timestamps changed**:
   - pushes branch `automation/free-model-evidence-<run_id>`,
   - opens a pull request against `main` with `gh pr create`.
   - **If the push or the PR creation fails, the run fails (red).** This is
     deliberate since 2026-11-06; the previous warn-and-exit-0 behaviour
     was removed because it silently dropped refreshes.
4. Independently of the refresh, an alert step assesses the evidence
   **as committed on `main`** (the triggering revision, not the refreshed
   working copy) via `scripts/check-free-model-expiry.sh`:
   - validity remaining **> 3 days** → no action;
   - validity remaining **≤ 3 days or already expired** → it opens a
     GitHub issue titled
     `[free-model-evidence-alert] Free-model evidence expires <reviewAfter> (google/gemma-4-31b-it:free)`
     containing the expiry date, the model, the detecting run link, and the
     required action. If an open alert issue already covers the same
     `reviewAfter`, no duplicate is created. If the issue cannot be
     created, the run fails (red) rather than dropping the alert silently.

Nothing in this automation merges a PR or deploys. Merge and production
publication require explicit owner approval — that is the owner's safety
design (see the publication gate document) and must not be automated away.

## Routine operation (the standard cycle)

Trigger: an alert issue appears, or the weekly check (below) finds a bot PR
waiting. Work through the steps in order; evidence refresh and deployment
are always one set — merging without deploying leaves production stale.

1. **Find the refresh PR.** Look for the open PR from branch
   `automation/free-model-evidence-*` titled
   `chore: refresh verified free-model evidence`. If the alert fired but no
   PR exists, check the detecting run: a red run at the PR step means the
   branch was pushed but the PR was not — create the PR manually from that
   branch (the run summary names it).
2. **Confirm CI is fully green** on that PR's latest commit (build-and-test
   on both Node versions, plus the fail-closed verifier/catalog tests). A
   red or stale SHA is not mergeable; a green result never carries over to
   a changed SHA.
3. **Owner approval.** Merging is the owner's explicit decision. Present
   the PR, its CI state, and the current `reviewAfter` deadline; merge
   only after approval. (Repository rule: no merge and no production
   deploy without the owner's explicit approval.)
4. **Merge** the PR into `main` (merge commit). Note the resulting `main`
   SHA — production must end up on exactly this SHA.
5. **Deploy manually in Vercel** (auto-deploy from `main` is disabled by
   design; a merge alone changes nothing in production):
   - Sign in to Vercel **with GitHub** (account/team
     `nori72nyprivate-6923`). The email-login account (`nori3`) does not
     contain the `origin-personal` project — this cost real time during
     the 2026-11-06 recovery.
   - Open project **origin-personal** → **Deployments** →
     **Create Deployment** → select branch `main` at the merged commit
     from step 4 → create. Wait until the build finishes with status
     **Ready** (the deployment is staged at this point, not yet live).
   - On that deployment: **Deployment Actions → Promote**, assigning the
     production domain `origin-personal.vercel.app`. Confirm the project
     Overview shows it as the Production Deployment.
   - (This is exactly the procedure used successfully on 2026-11-06 for
     merge commit `2792fc7`.)
6. **Verify production.**
   - `curl https://origin-personal.vercel.app/api/health` must return
     `releaseSha` equal to the merged `main` SHA from step 4.
   - Send one real chat request and confirm a normal answer (not 503, not
     `FREE_MODEL_EVIDENCE_STALE`).
   - Optionally dispatch the production smoke job
     (`workflow_dispatch`, post-publication phase) per the publication
     gate document.
7. **Close the alert issue** once step 6 passes, noting the deployed SHA.
   Closing matters: the dedup logic keys on open issues, so a stale open
   alert must not linger into the next cycle.

## Failure handling

| Signal | Meaning | Action |
|---|---|---|
| Run red at the verify step | $0.00 could not be proven (model paid/missing/API down) or evidence invalid | Do **not** enable any paid fallback. Investigate the verifier output; escalate to the owner. Production failing closed is the designed behaviour. |
| Run red at the PR step | Evidence verified and branch pushed, but PR creation failed (usually Actions PR permission) | Create the PR manually from the pushed branch named in the run summary, then continue the routine from step 2. Also fix the permission so the next cycle is automatic again. |
| Run red at the alert step | Expiry detected but the alert issue could not be created/listed | Create the alert issue manually with the same title format, then continue the routine. Check the job's `issues: write` permission. |
| Alert issue, no bot PR, all runs green | Refresh produced no diff (evidence was refreshed on a branch whose PR failed earlier, or the catalog changed by another route) | Inspect recent `automation/free-model-evidence-*` branches; open the PR manually from the newest one whose diff only touches the catalog timestamps. |
| Production 503 `FREE_MODEL_EVIDENCE_STALE` | Deployed evidence expired — the routine was not completed in time | Run the routine immediately (steps 1–7). Afterwards, note in the alert issue where the cycle stalled so the gap is visible. |

## First checks after the alerting change merges (one-time)

The alerting behaviour added on 2026-11-06 was verified locally (script
execution against healthy / near-expiry / expired catalogs, plus stubbed
`gh` runs of the step logic), but **live firing on GitHub Actions is
UNVERIFIED until observed**. After the PR that adds it merges, do these
checks once, in order:

1. Manually dispatch `Verify free model evidence` from `main`
   (`workflow_dispatch`, `force_refresh` off).
2. Confirm the run is green and the step
   *"Open an expiry alert issue when the evidence on main is expiring or
   expired"* logs `alert=false` / "no expiry alert required" while the
   evidence is healthy, and that **no issue was created**.
3. Confirm the job ran with the `issues: write` permission (no permission
   errors in the log). Note the alert step only calls `gh issue list` when
   an alert is actually due, so the issue-creation path itself stays
   unverified until the first real alert — if that first alert run goes
   red at the alert step, fall back to the manual issue creation in the
   table above.
4. At the first real alert (≤3 days remaining), confirm exactly one issue
   with the `[free-model-evidence-alert]` title appears, run the routine,
   and record the outcome on the issue.

## Cadence and ownership

- The bot runs 4×/day; the evidence window is 10 days; the alert threshold
  is 3 days. A human must look at open alert issues / waiting bot PRs **at
  least weekly**, and respond to an alert issue **before its
  `reviewAfter` date** — that date is the hard deadline, not a guideline.
- Ownership: the development lead watches for alert issues and prepares
  merge requests; the **owner** approves merges and production deploys.
- Housekeeping (non-urgent): merged or superseded
  `automation/free-model-evidence-*` branches may be deleted after their
  PR lands; they carry no unique content beyond the catalog timestamps.

## Explicit non-goals

- No auto-merge and no auto-deploy, ever, under this runbook. Approval is
  a human gate by design.
- No paid model, paid fallback, or billing change is ever an acceptable
  response to an evidence failure. The correct failure mode is a stopped,
  honest, fail-closed service plus a loud alert.
