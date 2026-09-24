import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createCodingNavigatorV14 } from "../../agent/codingNavigatorV14.js";
import { createCodingPlannerV14 } from "../../agent/codingPlannerV14.js";
import { createBoundedCodingProviderExecuteV14 } from "../../agent/codingProviderRetryV14.js";
import { runIsolatedCodingVerificationV14 } from "../../agent/codingIsolatedVerificationV14.js";
import { runCodingSessionV14 } from "../../agent/codingSessionV14.js";
import { copyTrustedCodingCheckoutV14 } from "../../agent/codingWorkerCheckoutV14.js";
import {
  executeOriginProvider,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "../../legacy/originProviderClient.js";
import type {
  OriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault.js";
import {
  createOriginAnswerQualityBenchmarkRuntimeAdapter,
  type OriginAnswerQualityBenchmarkRuntimeAdapter,
} from "./OriginAnswerQualityBenchmarkRuntimeAdapter.js";
import type {
  OriginAnswerQualityBenchmarkExecutableCase,
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner.js";

const executeFile = promisify(execFile);
const SHA40 = /^[a-f0-9]{40}$/;

export type OriginAnswerQualityBenchmarkGitExecutor = (
  args: readonly string[],
  cwd: string,
) => Promise<{ readonly stdout: string }>;

const executeGit: OriginAnswerQualityBenchmarkGitExecutor = async (args, cwd) => {
  const { stdout } = await executeFile("git", [...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    timeout: 5_000,
    maxBuffer: 1024,
    encoding: "utf8",
  });
  return { stdout };
};

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

async function checkoutRevision(
  root: string,
  git: OriginAnswerQualityBenchmarkGitExecutor,
): Promise<string> {
  const { stdout } = await git(["rev-parse", "--verify", "HEAD"], root);
  return stdout.trim();
}

async function assertCleanTrackedCheckout(
  root: string,
  git: OriginAnswerQualityBenchmarkGitExecutor,
): Promise<void> {
  try {
    await git(["diff-index", "--quiet", "HEAD", "--"], root);
  } catch {
    throw new Error("AQ_BENCHMARK_CODING_CHECKOUT_DIRTY");
  }
}

function providerErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function toolCallCount(audit: Awaited<ReturnType<typeof runCodingSessionV14>>["audit"]): number {
  return audit.reduce((total, event) => {
    if (event.action === "stopped") return total;
    if (event.action === "verified") return total + (event.checks?.length ?? 0);
    return total + 1;
  }, 0);
}

export interface OriginAnswerQualityBenchmarkCodingCheckoutAdapterOptions {
  readonly sourceRoot: string;
  readonly expectedGitSha: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
  readonly gitExecutor?: OriginAnswerQualityBenchmarkGitExecutor;
  readonly evidenceVault?: OriginAnswerQualityBenchmarkEphemeralEvidenceVault;
}

export async function createOriginAnswerQualityBenchmarkCodingCheckoutAdapter(
  options: OriginAnswerQualityBenchmarkCodingCheckoutAdapterOptions,
): Promise<OriginAnswerQualityBenchmarkRuntimeAdapter> {
  if (!SHA40.test(options.expectedGitSha)) {
    throw new Error("AQ_BENCHMARK_CODING_SHA_INVALID");
  }

  const sourceRoot = await fs.realpath(options.sourceRoot);
  const git = options.gitExecutor ?? executeGit;
  const observedSha = await checkoutRevision(sourceRoot, git);
  if (observedSha !== options.expectedGitSha) {
    throw new Error("AQ_BENCHMARK_CODING_SOURCE_SHA_MISMATCH");
  }
  await assertCleanTrackedCheckout(sourceRoot, git);
  await fs.access(path.join(sourceRoot, "node_modules"));

  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now;

  const executeCase = async (
    item: OriginAnswerQualityBenchmarkExecutableCase,
  ): Promise<OriginAnswerQualityBenchmarkExecutionEvidence> => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "origin-aq-coding-"));
    let providerRequests = 0;
    let costPolicyViolation = false;

    const countedPrimary = async (
      request: OriginProviderExecutionRequest,
      requestEnv: NodeJS.ProcessEnv,
    ): Promise<OriginProviderExecutionResult> => {
      providerRequests += 1;
      try {
        return await executeOriginProvider(request, requestEnv);
      } catch (error) {
        const code = providerErrorCode(error);
        if (code === "PROVIDER_COST_UNVERIFIED" || code === "PROVIDER_POLICY_VIOLATION") {
          costPolicyViolation = true;
        }
        throw error;
      }
    };

    const boundedExecute = createBoundedCodingProviderExecuteV14(countedPrimary);

    const startedAt = nowMs();
    try {
      await copyTrustedCodingCheckoutV14(sourceRoot, workspace);
      const navigator = createCodingNavigatorV14(workspace, { env, execute: boundedExecute });
      const planner = createCodingPlannerV14({ env, execute: boundedExecute });
      const session = await runCodingSessionV14({
        goal: item.prompt,
        root: workspace,
        trustedWorkspaceApproved: true,
      }, {
        discover: navigator,
        propose: planner,
        verify: root => runIsolatedCodingVerificationV14(root, sourceRoot),
      });

      if (costPolicyViolation) {
        throw new Error("AQ_BENCHMARK_CODING_ZERO_COST_UNVERIFIED");
      }

      const latencyMs = Math.max(0, nowMs() - startedAt);
      const finalSummary = {
        status: session.status,
        code: session.code,
        repairRounds: session.repairRounds,
        changedPaths: [...session.changedPaths].sort(),
        checks: session.audit
          .filter((event) => event.action === "verified")
          .flatMap((event) => event.checks ?? [])
          .map(({ kind, ok, exitCode, timedOut }) => ({ kind, ok, exitCode, timedOut })),
      };

      const verifierResult = session.status === "verified"
        ? "PASS"
        : session.status === "repair_limit"
          ? "REPAIR_REQUIRED"
          : "BLOCKED_UNVERIFIED";
      const finalAnswerRef = digest(finalSummary);
      const evidenceLedgerRef = digest(session.audit);

      options.evidenceVault?.put({
        caseId: item.caseId,
        finalAnswerRef,
        evidenceLedgerRef,
        answerText: JSON.stringify(finalSummary),
        evidenceJson: session.audit,
      });

      return {
        caseId: item.caseId,
        finalAnswerRef,
        evidenceLedgerRef,
        verifierResult,
        providerRequests,
        toolCalls: toolCallCount(session.audit),
        latencyMs,
        costUsd: 0,
        failureCode: session.status === "verified" ? null : session.code,
      };
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  };

  return createOriginAnswerQualityBenchmarkRuntimeAdapter(
    "coding",
    "coding-v1.4",
    executeCase,
  );
}
