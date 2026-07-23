import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ORIGIN Personal production entrypoint", () => {
  it("ships the truthful Personal release without legacy dashboard imports", () => {
    const entrypoint = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");

    expect(entrypoint).toContain("./components/personal/PersonalEditionApp");
    expect(entrypoint).toContain("./components/SettingsModal");
    expect(entrypoint).not.toMatch(/from\s+['"]\.\/App['"]/);
    expect(entrypoint).not.toContain("ResultDashboard");
    expect(entrypoint).not.toContain("FactCheckEngineView");
    expect(entrypoint).not.toContain("RoutingTester");
    expect(entrypoint).toContain("./hooks/usePersonalSettings");
    expect(entrypoint).not.toContain("./hooks/useAppState");
  });

  it("uses a Japanese-first, dependency-light document boundary", () => {
    const document = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const styles = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(document).toContain('<html lang="ja">');
    expect(document).toContain("<title>ORIGIN Personal</title>");
    expect(document).not.toContain("Ultimate");
    expect(document).not.toMatch(/img-src[^;]*https/);
    expect(document).not.toContain("fonts.googleapis.com");
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });

  it("does not mount the legacy dashboard API or Mission Engine", () => {
    const serverComposition = readFileSync(
      resolve(process.cwd(), "src/server/createOriginApp.ts"),
      "utf8",
    );

    expect(serverComposition).toContain("createOriginChatRouter");
    expect(serverComposition).toContain("createOriginLegacyProviderBoundaryRouter");
    expect(serverComposition).not.toContain("createLegacyRouter");
    expect(serverComposition).not.toContain("initMissionEngine");
    expect(serverComposition).not.toMatch(/app\.use\(\s*["']\/api\/v1["']/);
    expect(serverComposition).not.toMatch(/img-src[^;]*https/);
    expect(serverComposition).not.toContain("fonts.googleapis.com");
  });
});
