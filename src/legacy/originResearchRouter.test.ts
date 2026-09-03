import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const researchMock = vi.fn();
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { createOriginResearchRouter } from "./originResearchRouter.js";

describe("originResearchRouter", () => {
  beforeEach(() => researchMock.mockReset());

  it("returns live public-source evidence for explicit freshness requests", async () => {
    researchMock.mockResolvedValue({ ok: true, sources: [{ title: "AI optimization", url: "https://en.wikipedia.org/wiki/AI_optimization", excerpt: "Retrieved public material.", revisionTimestamp: "2026-09-01T00:00:00Z" }] });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIOの最新情報を教えて" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing).toMatchObject({ provider: "Wikipedia", cost: 0, actualCostUsd: 0, freeOnly: true });
    expect(response.body.content).toContain("Retrieved public material.");
    expect(response.body.content).toContain("https://en.wikipedia.org/wiki/AI_optimization");
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
});
