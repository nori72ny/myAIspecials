import { describe, expect, it } from "vitest";

import {
  isOriginToolDisclosedForCapability,
  listOriginToolsForCapability,
} from "./progressiveToolDisclosure";

describe("progressiveToolDisclosure", () => {
  it("discloses only coding tools for coding tasks", () => {
    const tools = listOriginToolsForCapability("coding");

    expect(tools.map((tool) => tool.name)).toEqual([
      "repository_explorer",
      "file_reader",
      "file_writer",
      "verification_runner",
      "code_interpreter",
    ]);
    expect(tools).toHaveLength(5);
  });

  it("keeps state-changing tools hidden from ordinary answer tasks", () => {
    const tools = listOriginToolsForCapability("answer");

    expect(tools.map((tool) => tool.name)).toEqual(["document_generator"]);
    expect(isOriginToolDisclosedForCapability("answer", "file_writer")).toBe(false);
    expect(isOriginToolDisclosedForCapability("answer", "verification_runner")).toBe(false);
  });

  it("does not weaken approval metadata", () => {
    for (const tool of listOriginToolsForCapability("coding")) {
      expect(tool.requiresApproval).toBe(true);
    }
    expect(listOriginToolsForCapability("coding").find((tool) => tool.name === "file_writer"))
      .toEqual(expect.objectContaining({ sideEffects: "write", requiresApproval: true }));
  });

  it("keeps disclosure bounded", () => {
    for (const capability of ["answer", "research", "coding", "writing", "analysis"] as const) {
      expect(listOriginToolsForCapability(capability).length).toBeLessThanOrEqual(6);
    }
  });
});
