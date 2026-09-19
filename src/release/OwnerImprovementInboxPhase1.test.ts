import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ORIGIN Owner Improvement Inbox Phase 1 gate", () => {
  it("keeps the inbox local-only with no credentialed external write path", () => {
    const store = read("src/lib/local/OwnerImprovementStore.ts");
    const inbox = read("src/components/owner/OwnerImprovementInbox.tsx");

    expect(store).toContain('const DB_NAME = "origin-owner-improvements"');
    expect(store).toContain("indexedDB.open");
    expect(store).toContain("localOnly: true");
    expect(store).not.toContain("fetch(");
    expect(store).not.toContain("localStorage");
    expect(inbox).toContain("detectSensitiveInput");
    expect(inbox).not.toContain("GITHUB_TOKEN");
    expect(inbox).not.toContain("VERCEL");
    expect(inbox).not.toContain("SUPABASE");
  });

  it("exposes a dedicated owner improvement entry point", () => {
    const inbox = read("src/components/owner/OwnerImprovementInbox.tsx");
    const app = read("src/App.tsx");

    expect(inbox).toContain('data-testid="owner-improvement-toggle"');
    expect(inbox).toContain('data-testid="owner-improvement-inbox"');
    expect(inbox).toContain('data-testid="owner-improvement-submit"');
    expect(app).toContain("<OwnerImprovementInbox language={language} />");
  });

  it("continues normal chat while conservatively recording explicit improvement intent", () => {
    const app = read("src/App.tsx");
    const intent = read("src/lib/owner/OwnerImprovementIntent.ts");

    expect(app).toContain("detectExplicitOwnerImprovementIntent");
    expect(app).toContain('source: "chat-routing"');
    expect(app).toContain("Saved as an Owner improvement request while continuing this chat.");
    expect(intent).toContain("explicitOriginTarget");
    expect(intent).toContain("improvementVerb");
  });

  it("does not grant repository, deployment, model, or security-policy authority", () => {
    const policy = read("docs/ORIGIN_OWNER_IMPROVEMENT_INBOX.md");
    expect(policy).toContain("No GitHub/Vercel/Supabase write occurs");
    expect(policy).toContain("No Production deploy occurs");
    expect(policy).toContain("explicit Owner approval");
    expect(policy).toContain("Source→Sink boundary");
  });
});
