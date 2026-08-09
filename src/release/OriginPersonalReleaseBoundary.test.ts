import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("ORIGIN Personal production entrypoint", () => {
  it("ships the truthful Personal release without legacy dashboard imports", () => {
    const entrypoint = readRepositoryFile("src/main.tsx");

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
    const document = readRepositoryFile("index.html");
    const styles = readRepositoryFile("src/index.css");

    expect(document).toContain('<html lang="ja">');
    expect(document).toContain("<title>ORIGIN Personal</title>");
    expect(document).not.toContain("Ultimate");
    expect(document).not.toMatch(/img-src[^;]*https/);
    expect(document).not.toMatch(/media-src[^;]*https/);
    expect(document).not.toContain("fonts.googleapis.com");
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });

  it("does not mount the legacy dashboard API or Mission Engine", () => {
    const serverComposition = readRepositoryFile("src/server/createOriginApp.ts");

    expect(serverComposition).toContain("createOriginChatRouter");
    expect(serverComposition).toContain("createOriginLegacyProviderBoundaryRouter");
    expect(serverComposition).not.toContain("createLegacyRouter");
    expect(serverComposition).not.toContain("initMissionEngine");
    expect(serverComposition).not.toMatch(/app\.use\(\s*["']\/api\/v1["']/);
    expect(serverComposition).not.toMatch(/img-src[^;]*https/);
    expect(serverComposition).not.toContain("fonts.googleapis.com");
  });

  it("keeps fake projects, memory, samples, and unimplemented controls out of the release UI", () => {
    const releaseUi = [
      readRepositoryFile("src/main.tsx"),
      readRepositoryFile("src/components/personal/PersonalEditionApp.tsx"),
      readRepositoryFile("src/components/personal/PersonalDashboard.tsx"),
      readRepositoryFile("src/components/personal/UnifiedChat.tsx"),
      readRepositoryFile("src/components/SettingsModal.tsx"),
    ].join("\n");

    expect(releaseUi).not.toMatch(/ProjectWorkspace|PersonalMemory/);
    expect(releaseUi).not.toMatch(/ACOS Development|Sales Deck|Traffic Accident/);
    expect(releaseUi).not.toMatch(/Memory Fragments|Manage Data|New Project|Continue Chat/);
    expect(releaseUi).not.toMatch(/Switch to Enterprise|AI Core:/);
    expect(releaseUi).not.toMatch(/encrypted and stored locally|train base models/i);
  });

  it("keeps Google AI Studio direct runtime disconnected from the formal release chat route", () => {
    const formalEntrypoints = [
      readRepositoryFile("api/index.ts"),
      readRepositoryFile("server.ts"),
      readRepositoryFile("src/server/createOriginApp.ts"),
      readRepositoryFile("src/legacy/originChatRouter.ts"),
      readRepositoryFile("worker/index.mjs"),
    ].join("\n");

    expect(formalEntrypoints).not.toMatch(/createOriginAiStudioRuntimeCoordinator/);
    expect(formalEntrypoints).not.toMatch(/originAiStudioInteractionsAdapter/);
    expect(formalEntrypoints).not.toMatch(/ORIGIN_AI_STUDIO_API_KEY/);
    expect(formalEntrypoints).not.toMatch(/ORIGIN_AI_STUDIO_RUNTIME_ENABLED/);
    expect(formalEntrypoints).toContain("createOriginChatRouter");
    expect(formalEntrypoints).toContain("providerExecutionEnabled: false");
  });
});
