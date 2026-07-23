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
  });
});
