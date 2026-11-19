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
    // Static document headers are defined in vercel.json. The former
    // public/_headers file used a Netlify/Cloudflare Pages format that
    // Vercel never read, and it was removed in the 2026-11-19 security
    // follow-up; the assertions below target the live definition instead.
    // HSTS for static documents is the Vercel platform default
    // (max-age=63072000; includeSubDomains; preload, measured in the
    // 2026-11-19 security check) and is not defined in repository config,
    // so it is no longer asserted here.
    const vercelConfig = JSON.parse(readProjectFile("vercel.json")) as {
      headers?: Array<{ headers?: Array<{ key?: string; value?: string }> }>;
    };
    const documentRule = (vercelConfig.headers ?? []).find((rule) =>
      (rule.headers ?? []).some(
        (header) => header.key === "Content-Security-Policy" && header.value?.startsWith("default-src 'self'"),
      ),
    );
    const staticHeaders = new Map(
      (documentRule?.headers ?? []).map((header) => [header.key, header.value]),
    );
    const contentSecurityPolicy = staticHeaders.get("Content-Security-Policy") ?? "";

    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy).toContain("connect-src 'self'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(staticHeaders.has("X-Frame-Options")).toBe(false);
    expect(staticHeaders.get("X-Content-Type-Options")).toBe("nosniff");
    // The statically served document must carry the same Permissions-Policy
    // and cross-origin isolation headers as API responses (set by
    // applyOriginSecurityHeaders in src/server/originSecurity.ts), so the
    // intended policy also applies to the top-level document.
    expect(staticHeaders.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
    );
    expect(staticHeaders.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(staticHeaders.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });
});
