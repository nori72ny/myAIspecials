import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { createOriginResearchRouter } from "./originResearchRouter.js";

describe("originResearchRouter", () => {
  beforeEach(() => researchMock.mockReset());

  it("returns live public-source evidence for explicit freshness requests", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "DuckDuckGo", sources: [
      { title: "AI optimization", url: "https://example.com/ai", excerpt: "Retrieved public material.", domain: "example.com", rank: 1, sourceType: "web-search" },
      { title: "AI overview", url: "https://example.org/ai", excerpt: "Independent public material.", domain: "example.org", rank: 2, sourceType: "web-search" },
    ] });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIOの最新情報を教えて" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing).toMatchObject({ provider: "DuckDuckGo", cost: 0, actualCostUsd: 0, freeOnly: true });
    expect(response.body.research.sources).toHaveLength(2);
    expect(response.body.content).toContain("Retrieved public material.");
    expect(response.body.content).toContain("https://example.com/ai");
    expect(response.body.content).toContain("https://example.org/ai");
  });

  it("does not intercept stable definition requests", async () => {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    app.use((_req, res) => res.status(418).json({ passedThrough: true }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIOとは？" }] });
    expect(response.status).toBe(418);
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("fails closed to the existing router when the research source is unavailable", async () => {
    researchMock.mockResolvedValue({ ok: false, sources: [], limitation: "source unavailable" });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    app.use((_req, res) => res.status(418).json({ passedThrough: true }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIの最新情報は？" }] });
    expect(response.status).toBe(418);
    expect(researchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks sensitive freshness queries before any external research call", async () => {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "最新情報を調べて API key=super-secret-123" }] });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED");
    expect(researchMock).not.toHaveBeenCalled();
  });
});
