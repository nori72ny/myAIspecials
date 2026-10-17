import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function lexicalPath(raw, runnerTemp) {
  if (!raw || !runnerTemp || !isAbsolute(raw)) return null;
  const root = resolve(runnerTemp);
  const file = resolve(raw);
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return { root, file };
}

function unchanged(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

export function readBoundedRunnerTempFile(raw, runnerTemp, maxBytes) {
  const boundedMax = Number(maxBytes);
  if (!raw) return { ok: false, code: "MISSING" };
  if (!Number.isFinite(boundedMax) || boundedMax <= 0) return { ok: false, code: "POLICY_INVALID" };
  if (process.platform !== "linux") return { ok: false, code: "PLATFORM_UNSUPPORTED" };

  const lexical = lexicalPath(raw, runnerTemp);
  if (!lexical) return { ok: false, code: "PATH_UNSAFE" };

  let fd;
  try {
    const noFollow = Number(constants.O_NOFOLLOW || 0);
    fd = openSync(lexical.file, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { ok: false, code: "NOT_FOUND" };
    }
    return { ok: false, code: "OPEN_REJECTED" };
  }

  try {
    const before = fstatSync(fd);
    if (!before.isFile()) return { ok: false, code: "NOT_REGULAR_FILE" };
    if (before.size > boundedMax) return { ok: false, code: "TOO_LARGE" };

    const realRoot = realpathSync(lexical.root);
    const openedPath = realpathSync(`/proc/self/fd/${fd}`);
    const rel = relative(realRoot, openedPath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      return { ok: false, code: "REALPATH_UNSAFE" };
    }

    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (!unchanged(before, after)) return { ok: false, code: "CHANGED_DURING_READ" };
    if (bytes.byteLength > boundedMax) return { ok: false, code: "TOO_LARGE" };

    return {
      ok: true,
      code: "OK",
      bytes,
      size: bytes.byteLength,
      resolvedPath: openedPath
    };
  } catch {
    return { ok: false, code: "READ_REJECTED" };
  } finally {
    closeSync(fd);
  }
}
