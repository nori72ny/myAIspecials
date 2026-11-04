import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileTool, validateSecureFetchUrl } from "../application/agent/ToolExecutor";


describe("ToolExecutor network egress boundary", () => {
  it.each([
    "http://wikipedia.org/wiki/Test",
    "https://user:secret@wikipedia.org/wiki/Test",
    "https://wikipedia.org:8443/wiki/Test",
    "https://api.github.com/repos/example/demo?token=synthetic",
    "https://api.github.com/repos/example/demo?api_key=synthetic",
    "https://duckduckgo.com/?access-token=synthetic",
  ])("rejects a risky outbound URL before DNS/network access: %s", (url) => {
    expect(() => validateSecureFetchUrl(url)).toThrow(/Access denied/);
  });

  it("accepts a whitelisted public HTTPS URL and strips the fragment", () => {
    expect(validateSecureFetchUrl("https://api.github.com/repos/example/demo#readme").toString())
      .toBe("https://api.github.com/repos/example/demo");
  });

  it("still rejects a non-allowlisted public hostname", () => {
    expect(() => validateSecureFetchUrl("https://example.com/public")).toThrow(/not whitelisted/);
  });
});

describe("ToolExecutor legacy FileTool security boundary", () => {
  it("disables the legacy write primitive without touching the filesystem", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "origin-legacy-filetool-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(root);
      const tool = new FileTool();
      const result = await tool.execute({ action: "write", path: "should-not-exist.txt", content: "blocked" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("LEGACY_FILE_WRITE_DISABLED");
      await expect(fs.access(path.join(root, "should-not-exist.txt"))).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("blocks traversal and protected paths", async () => {
    const tool = new FileTool();
    await expect(tool.execute({ action: "read", path: "../package.json" })).resolves.toEqual(expect.objectContaining({ success: false }));
    await expect(tool.execute({ action: "read", path: ".env" })).resolves.toEqual(expect.objectContaining({ success: false }));
    await expect(tool.execute({ action: "read", path: "node_modules/package.json" })).resolves.toEqual(expect.objectContaining({ success: false }));
  });

  it("blocks an intermediate symlink before a read can escape the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "origin-legacy-filetool-root-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "origin-legacy-filetool-outside-"));
    const originalCwd = process.cwd();
    try {
      await fs.writeFile(path.join(outside, "secret.txt"), "do-not-read", "utf8");
      await fs.symlink(outside, path.join(root, "link"), "dir");
      const tool = new FileTool();
      process.chdir(root);
      const result = await tool.execute({ action: "read", path: "link/secret.txt" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("SYMLINK_PATH_BLOCKED");
    } finally {
      process.chdir(originalCwd);
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
