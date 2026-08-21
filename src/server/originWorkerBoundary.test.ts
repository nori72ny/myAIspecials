import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Cloudflare Workers free boundary", () => {
  it("routes API requests through the Worker before the SPA fallback", () => {
    const config = JSON.parse(readProjectFile("wrangler.jsonc"));

    expect(config.main).toBe("worker.ts");
    expect(config.compatibility_flags).toContain("nodejs_compat");
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(true);
    expect(config.vars).toEqual({ FREE_ONLY: "true" });
    expect(config.assets.not_found_handling).toBe("single-page-application");
    expect(config.assets.run_worker_first).toEqual(["/api/*", "/health"]);
    expect(config.routes).toBeUndefined();
    expect(config.account_id).toBeUndefined();
  });

  it("pins every Worker command to the free-preview configuration", () => {
    const packageJson = JSON.parse(readProjectFile("package.json"));

    expect(packageJson.scripts["check:worker"]).toContain(
      "--config wrangler.jsonc",
    );
    expect(packageJson.scripts["check:worker"]).toContain("--dry-run");
    expect(packageJson.scripts["check:worker"]).not.toContain("wrangler.toml");
  });

  it("passes only approved runtime values into the existing application", () => {
    const worker = readProjectFile("worker.ts");

    expect(worker).toContain("createOriginApp");
    expect(worker).toContain('NODE_ENV: "production"');
    expect(worker).toContain('FREE_ONLY: "true"');
    expect(worker).not.toContain("bindings.FREE_ONLY");
    expect(worker).toContain("OPENROUTER_API_KEY");
    expect(worker).toContain("APP_URL");
    expect(worker).toContain("ORIGIN_RELEASE_SHA");
    expect(worker).not.toContain("DATABASE_URL");
    expect(worker).not.toContain("REDIS_URL");
    expect(worker).not.toContain("GEMINI_API_KEY");
    expect(worker).not.toContain("Object.assign");
    expect(worker).not.toContain("...env");
  });

  it("keeps production framing and script restrictions on static responses", () => {
    const headers = readProjectFile("public/_headers");

    expect(headers).toContain("script-src 'self'");
    expect(headers).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(headers).not.toContain("'unsafe-eval'");
    expect(headers).toContain("connect-src 'self'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).not.toContain("X-Frame-Options");
    expect(headers).toContain("Strict-Transport-Security");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
  });
});
