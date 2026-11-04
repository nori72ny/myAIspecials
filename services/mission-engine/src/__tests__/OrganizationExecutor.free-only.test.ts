import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationExecutor } from "../application/organization/OrganizationExecutor";

describe("OrganizationExecutor FREE_ONLY boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects legacy organization routing before provider discovery or client use", async () => {
    vi.stubEnv("FREE_ONLY", "true");
    const generateText = vi.fn();
    const executor = new OrganizationExecutor();

    await expect(executor.executeMission("mission-test", "test objective", { generateText }))
      .rejects.toThrow("FREE_ONLY_PROVIDER_BOUNDARY");
    expect(generateText).not.toHaveBeenCalled();
  });
});
