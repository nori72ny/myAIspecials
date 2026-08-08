import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/assert-origin-release-sha.mjs");
const startup = resolve(process.cwd(), "scripts/start-cloud-run.mjs");

function validate(candidate?: string) {
  return spawnSync(
    process.execPath,
    candidate === undefined ? [script] : [script, candidate],
    { encoding: "utf8", env: {} },
  );
}

describe("Cloud Run release SHA validator", () => {
  it("accepts an exact lowercase immutable Git SHA", () => {
    const result = validate("0123456789abcdef0123456789abcdef01234567");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([
    undefined,
    "",
    "unknown",
    "main",
    "123abc7d23644b9fa68270539819370f4721a36",
    "123abc7d23644b9fa68270539819370f4721a3690",
    "123abc7d23644b9fa68270539819370f4721a36z",
    "123ABC7D23644B9FA68270539819370F4721A369",
    " 123abc7d23644b9fa68270539819370f4721a369",
    "123abc7d23644b9fa68270539819370f4721a369 ",
  ])("rejects non-immutable release identity %s", (candidate) => {
    const result = validate(candidate);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "ORIGIN_RELEASE_SHA must be the exact 40-character lowercase Git commit SHA",
    );
  });

  it("stops the Cloud Run entrypoint before loading the server when SHA is invalid", () => {
    const directory = mkdtempSync(join(tmpdir(), "origin-release-"));
    const imageShaFile = join(directory, "ORIGIN_RELEASE_SHA");
    writeFileSync(imageShaFile, "0123456789abcdef0123456789abcdef01234567");
    const result = spawnSync(process.execPath, [startup], {
      encoding: "utf8",
      env: {
        ORIGIN_RELEASE_SHA: "unknown",
        ORIGIN_IMAGE_RELEASE_SHA_FILE: imageShaFile,
      },
    });
    rmSync(directory, { recursive: true, force: true });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "ORIGIN_RELEASE_SHA must be the exact 40-character lowercase Git commit SHA",
    );
    expect(result.stdout).not.toContain("Server running");
  });
});
