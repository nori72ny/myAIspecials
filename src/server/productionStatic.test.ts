import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { isBlockedStaticArtifact, productionStaticProtection } from "./productionStatic";

describe("productionStaticProtection", () => {
  it("detects blocked filenames correctly", () => {
    expect(isBlockedStaticArtifact("/server.cjs")).toBe(true);
    expect(isBlockedStaticArtifact("/SERVER.CJS")).toBe(true);
    expect(isBlockedStaticArtifact("/%73erver.cjs")).toBe(true);
    expect(isBlockedStaticArtifact("/%2573erver.cjs")).toBe(true);
    expect(isBlockedStaticArtifact("/dist/server.cjs")).toBe(true);
    expect(isBlockedStaticArtifact("/..%2fdist/server.cjs")).toBe(true);

    expect(isBlockedStaticArtifact("/main.js.map")).toBe(true);
    expect(isBlockedStaticArtifact("/assets/index-12345.js.map")).toBe(true);
    expect(isBlockedStaticArtifact("/%6d3in.js.map")).toBe(true);
    expect(isBlockedStaticArtifact("/server.cjs.map")).toBe(true);

    expect(isBlockedStaticArtifact("/index.html")).toBe(false);
    expect(isBlockedStaticArtifact("/assets/index.js")).toBe(false);
    expect(isBlockedStaticArtifact("/api/chat")).toBe(false);
  });

  it("blocks server.cjs and map files with 404 in express app", async () => {
    const app = express();
    app.use(productionStaticProtection);
    app.get("/index.html", (_req, res) => res.send("OK"));

    const resServerCjs = await request(app).get("/server.cjs");
    expect(resServerCjs.status).toBe(404);
    expect(resServerCjs.body.code).toBe("NOT_FOUND");

    const resEncodedServerCjs = await request(app).get("/%73erver.cjs");
    expect(resEncodedServerCjs.status).toBe(404);

    const resSourceMap = await request(app).get("/assets/index.js.map");
    expect(resSourceMap.status).toBe(404);

    const resOk = await request(app).get("/index.html");
    expect(resOk.status).toBe(200);
    expect(resOk.text).toBe("OK");
  });
});
