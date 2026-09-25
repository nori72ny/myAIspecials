import { describe, expect, it } from "vitest";

import {
  originRequirementClarificationInstruction,
  requirementDimensionsForIntent,
} from "./OriginRequirementClarifier";
import { classifyOriginRequestIntent } from "./OriginRequestIntent";

describe("OriginRequirementClarifier", () => {
  it("does not force a clarification questionnaire for a plain conversation", () => {
    const intent = classifyOriginRequestIntent("考えを整理するのを手伝ってください", "review");
    expect(requirementDimensionsForIntent(intent)).toEqual([]);
    expect(originRequirementClarificationInstruction(intent)).toContain(
      "does not currently require a formal requirement-discovery loop",
    );
  });

  it("focuses spreadsheet creation on the requirements that materially affect usability", () => {
    const intent = classifyOriginRequestIntent("売上管理用のExcelを作ってください", "documentation");
    const dimensions = requirementDimensionsForIntent(intent);

    expect(dimensions).toEqual(expect.arrayContaining([
      "objective",
      "audience",
      "usage-context",
      "success-criteria",
      "data-fields",
      "calculation-aggregation",
      "storage-sharing",
      "import-export",
    ]));
  });

  it("focuses app creation on workflows, devices, persistence, permissions and verification", () => {
    const intent = classifyOriginRequestIntent("売上管理アプリを開発してください", "implementation");
    const instruction = originRequirementClarificationInstruction(intent);

    for (const phrase of [
      "user-workflows",
      "platform-device",
      "storage-sharing",
      "permissions-integrations",
      "expected-behavior",
      "verification",
      "Ask one to three focused questions per turn",
      "Never ask the same requirement twice",
      "once the request is sufficiently specified, stop questioning and execute",
    ]) expect(instruction).toContain(phrase);
  });

  it("asks image-specific questions only around material visual unknowns", () => {
    const intent = classifyOriginRequestIntent(
      "この人物はそのままで背景だけ東京にした画像を作ってください",
      "implementation",
    );
    const dimensions = requirementDimensionsForIntent(intent);
    const instruction = originRequirementClarificationInstruction(intent);

    expect(dimensions).toEqual(expect.arrayContaining([
      "reference-images",
      "exact-text",
      "change-preserve",
      "aspect-output",
      "style-reference",
      "identity-fidelity",
      "verification",
    ]));
    expect(instruction).toContain("required text, reference images, aspect/output format");
    expect(instruction).toContain("preserve-first edit");
    expect(instruction).toContain("背景だけ変えて");
  });

  it("adds approval and verification concerns to end-to-end workflows without making every dimension mandatory", () => {
    const intent = classifyOriginRequestIntent(
      "市場を調査してホームページを完成まで制作してください",
      "research",
    );
    const instruction = originRequirementClarificationInstruction(intent);

    expect(instruction).toContain("deadline-budget");
    expect(instruction).toContain("permissions-integrations");
    expect(instruction).toContain("verification");
    expect(instruction).toContain("not a mandatory questionnaire");
  });
});
