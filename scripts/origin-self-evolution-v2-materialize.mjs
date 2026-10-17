import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const EXACT_SHA = /^[0-9a-f]{40}$/;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
    ...options
  });
}

function isWithin(root, pathValue) {
  const rel = relative(root, pathValue);
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

function pathHasSymlink(workspace, relativePath) {
  const absolute = resolve(workspace, relativePath);
  if (!isWithin(workspace, absolute)) return true;
  let current = absolute;
  while (isWithin(workspace, current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      // New files may not exist yet; continue checking existing parents.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

function statusPaths(statusOutput) {
  const records = statusOutput.split("\0").filter(Boolean);
  const paths = [];
  for (const record of records) {
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    if (status.includes("R") || status.includes("C")) return { ok: false, paths: [] };
    paths.push(record.slice(3));
  }
  return { ok: true, paths };
}

export function materializeArtifactAgainstExactBase({
  artifact,
  artifactSha256,
  exactBaseSha,
  runnerTemp,
  repositoryRoot
}) {
  if (!artifact || !Array.isArray(artifact.files)) return { ok: false, reason: "MATERIALIZATION_ARTIFACT_INVALID" };
  if (!EXACT_SHA.test(String(exactBaseSha || ""))) return { ok: false, reason: "MATERIALIZATION_BASE_SHA_INVALID" };
  if (!/^[a-f0-9]{64}$/.test(String(artifactSha256 || ""))) return { ok: false, reason: "MATERIALIZATION_ARTIFACT_DIGEST_INVALID" };
  if (!runnerTemp || !repositoryRoot) return { ok: false, reason: "MATERIALIZATION_CONTEXT_MISSING" };
  if (process.platform !== "linux") return { ok: false, reason: "MATERIALIZATION_PLATFORM_UNSUPPORTED" };

  let root;
  let tempRoot;
  try {
    root = realpathSync(resolve(repositoryRoot));
    const inside = run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root }).trim();
    if (inside !== "true") return { ok: false, reason: "MATERIALIZATION_GIT_REPOSITORY_INVALID" };
    try {
      run("git", ["cat-file", "-e", `${exactBaseSha}^{commit}`], { cwd: root });
    } catch {
      return { ok: false, reason: "MATERIALIZATION_BASE_COMMIT_MISSING" };
    }

    const realRunnerTemp = realpathSync(resolve(runnerTemp));
    tempRoot = mkdtempSync(join(realRunnerTemp, "origin-self-evolution-materialize-"));
    const workspace = join(tempRoot, "workspace");
    const archivePath = join(tempRoot, "base.tar");
    const patchPath = join(tempRoot, "experiment.patch");
    mkdirSync(workspace, { recursive: true });

    run("git", ["archive", "--format=tar", `--output=${archivePath}`, exactBaseSha], { cwd: root });
    run("tar", ["-xf", archivePath, "-C", workspace], { cwd: tempRoot });

    const declaredPaths = artifact.files.map((file) => String(file.path || ""));
    if (new Set(declaredPaths).size !== declaredPaths.length) {
      return { ok: false, reason: "MATERIALIZATION_DUPLICATE_PATH" };
    }
    if (declaredPaths.some((pathValue) => pathHasSymlink(workspace, pathValue))) {
      return { ok: false, reason: "MATERIALIZATION_SYMLINK_PATH_BLOCKED" };
    }

    const patchText = artifact.files.map((file) => String(file.patch || "")).join("\n");
    writeFileSync(patchPath, patchText, "utf8");

    run("git", ["init", "-q"], { cwd: workspace });
    run("git", ["config", "user.name", "ORIGIN Isolated Verifier"], { cwd: workspace });
    run("git", ["config", "user.email", "origin-isolated-verifier@invalid.local"], { cwd: workspace });
    run("git", ["add", "-A"], { cwd: workspace });
    run("git", ["commit", "-q", "--no-gpg-sign", "-m", "exact-base-snapshot"], {
      cwd: workspace,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z"
      }
    });

    try {
      run("git", ["apply", "--check", "--whitespace=nowarn", patchPath], { cwd: workspace });
      run("git", ["apply", "--whitespace=nowarn", patchPath], { cwd: workspace });
    } catch {
      return { ok: false, reason: "MATERIALIZATION_PATCH_DOES_NOT_APPLY" };
    }

    const status = run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: workspace });
    const changed = statusPaths(status);
    if (!changed.ok) return { ok: false, reason: "MATERIALIZATION_RENAME_OR_COPY_BLOCKED" };

    const actualPaths = Array.from(new Set(changed.paths)).sort();
    const expectedPaths = Array.from(new Set(declaredPaths)).sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      return { ok: false, reason: "MATERIALIZATION_CHANGED_PATH_MISMATCH", expectedPaths, actualPaths };
    }

    for (const pathValue of actualPaths) {
      const absolute = resolve(workspace, pathValue);
      try {
        if (lstatSync(absolute).isSymbolicLink()) {
          return { ok: false, reason: "MATERIALIZATION_OUTPUT_SYMLINK_BLOCKED" };
        }
      } catch {
        // Deleted files are expected to be absent.
      }
    }

    const digest = createHash("sha256")
      .update([exactBaseSha, artifactSha256, ...actualPaths].join("|"))
      .digest("hex");

    return {
      ok: true,
      reason: "MATERIALIZATION_VERIFIED",
      materializationDigest: digest,
      changedPaths: actualPaths
    };
  } catch {
    return { ok: false, reason: "MATERIALIZATION_VERIFICATION_FAILED" };
  } finally {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  }
}
