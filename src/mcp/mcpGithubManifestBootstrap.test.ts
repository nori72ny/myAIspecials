import { describe, expect, it } from "vitest";
import {
  createMcpGithubAppManifestBootstrap,
  githubManifestConversionUrl,
  McpGithubManifestError,
  verifyGithubManifestConversion,
} from "./mcpGithubManifestBootstrap.js";

const state = "A".repeat(48);

describe("MCP GitHub App manifest bootstrap", () => {
  it("builds a private read-only no-event manifest with same-origin callbacks", () => {
    const result = createMcpGithubAppManifestBootstrap({
      appOrigin: "https://origin-personal.vercel.app",
      appName: "ORIGIN Personal Readonly",
      state,
    });

    expect(result.action).toBe("https://github.com/settings/apps/new?state=" + state);
    const manifest = JSON.parse(result.manifest);
    expect(manifest).toEqual({
      name: "ORIGIN Personal Readonly",
      url: "https://origin-personal.vercel.app/",
      redirect_url: "https://origin-personal.vercel.app/api/mcp/github/manifest/callback",
      callback_urls: ["https://origin-personal.vercel.app/api/mcp/oauth/github/callback"],
      setup_url: "https://origin-personal.vercel.app/api/mcp/github/install/callback",
      setup_on_update: true,
      public: false,
      request_oauth_on_install: false,
      default_permissions: { contents: "read" },
      default_events: [],
    });
    expect(result.manifest).not.toContain("secret");
    expect(result.manifest).not.toContain("token");
  });

  it.each([
    "http://origin.example.com",
    "https://user:pass@origin.example.com",
    "https://origin.example.com/path",
    "https://origin.example.com?x=1",
  ])("rejects non-canonical application origins (%s)", appOrigin => {
    expect(() => createMcpGithubAppManifestBootstrap({
      appOrigin,
      appName: "ORIGIN Personal Readonly",
      state,
    })).toThrow(McpGithubManifestError);
  });

  it("accepts only the reviewed owner, read-only contents permission and no events", () => {
    const result = verifyGithubManifestConversion({
      id: 123,
      slug: "origin-personal-readonly",
      client_id: "Iv1_abcdefgh12345678",
      client_secret: "secret_abcdefghijklmnopqrstuvwxyz123456",
      pem: "must-not-be-returned",
      webhook_secret: "must-not-be-returned",
      owner: { login: "nori72ny" },
      permissions: { contents: "read", metadata: "read" },
      events: [],
    }, "nori72ny");

    expect(result).toEqual({
      appId: 123,
      appSlug: "origin-personal-readonly",
      ownerLogin: "nori72ny",
      clientId: "Iv1_abcdefgh12345678",
      clientSecret: "secret_abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-be-returned");
  });

  it.each([
    [{ contents: "write" }, [], "MCP_GITHUB_PERMISSION_EXPANSION"],
    [{ contents: "read", issues: "read" }, [], "MCP_GITHUB_PERMISSION_EXPANSION"],
    [{ contents: "read" }, ["push"], "MCP_GITHUB_EVENT_EXPANSION"],
  ] as const)("fails closed on permission/event expansion", (permissions, events, code) => {
    try {
      verifyGithubManifestConversion({
        id: 123,
        slug: "origin-personal-readonly",
        client_id: "Iv1_abcdefgh12345678",
        client_secret: "secret_abcdefghijklmnopqrstuvwxyz123456",
        owner: { login: "nori72ny" },
        permissions,
        events,
      }, "nori72ny");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(McpGithubManifestError);
      expect((error as McpGithubManifestError).code).toBe(code);
    }
  });

  it("fails closed on owner mismatch", () => {
    expect(() => verifyGithubManifestConversion({
      id: 123,
      slug: "origin-personal-readonly",
      client_id: "Iv1_abcdefgh12345678",
      client_secret: "secret_abcdefghijklmnopqrstuvwxyz123456",
      owner: { login: "someone-else" },
      permissions: { contents: "read" },
      events: [],
    }, "nori72ny")).toThrowError("MCP_GITHUB_OWNER_MISMATCH");
  });

  it("builds only the fixed GitHub manifest conversion endpoint", () => {
    const code = "abcDEF0123456789_-abcDEF0123456789";
    expect(githubManifestConversionUrl(code)).toBe(
      "https://api.github.com/app-manifests/" + code + "/conversions",
    );
    expect(() => githubManifestConversionUrl("../escape")).toThrow(McpGithubManifestError);
  });
});
