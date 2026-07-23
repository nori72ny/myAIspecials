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
});
