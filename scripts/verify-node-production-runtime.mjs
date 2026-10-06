import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = "8790";
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/server.cjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    TEST_PORT: port,
    FREE_ONLY: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

try {
  let healthResponse;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited before becoming ready.\n${output}`);
    }
    try {
      healthResponse = await fetch(`${baseUrl}/api/health`);
      if (healthResponse.ok) break;
    } catch {
      // Server startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  assert.ok(healthResponse, `Production server did not become ready.\n${output}`);
  assert.equal(healthResponse.status, 200);
  assert.match(healthResponse.headers.get("content-type") ?? "", /application\/json/i);

  const health = await healthResponse.json();
  assert.equal(health.status, "ok");

  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type") ?? "", /text\/html/i);
  assert.match(await pageResponse.text(), /<!doctype|<html/i);

  const artifactStatusResponse = await fetch(`${baseUrl}/api/artifacts/v1.2/status`);
  assert.equal(artifactStatusResponse.status, 200);
  const artifactStatus = await artifactStatusResponse.json();
  assert.equal(artifactStatus.ready, true);
  assert.equal(artifactStatus.generatorSelfTest.pdf, true);

  const unicodePdfResponse = await fetch(`${baseUrl}/api/artifacts/v1.2/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "pdf",
      title: "日本語PDF検証",
      content: "営業資料：前年比を確認します。 ABC 123",
    }),
  });
  assert.equal(unicodePdfResponse.status, 200);
  assert.match(unicodePdfResponse.headers.get("content-type") ?? "", /application\/pdf/i);
  assert.equal(unicodePdfResponse.headers.get("x-origin-artifact-verified"), "true");
  assert.equal(unicodePdfResponse.headers.get("x-origin-free-only"), "true");
  assert.equal(unicodePdfResponse.headers.get("x-origin-cost-usd"), "0");
  const unicodePdfBytes = Buffer.from(await unicodePdfResponse.arrayBuffer());
  assert.equal(unicodePdfBytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(unicodePdfBytes.length > 1000);

  const pptxContent = [...Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`), "FINAL_SENTINEL_21"].join("\n");
  const pptxResponse = await fetch(`${baseUrl}/api/artifacts/v1.2/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "pptx",
      title: "PPTX integrity",
      slides: [{ title: "PPTX integrity", content: pptxContent }],
    }),
  });
  assert.equal(pptxResponse.status, 200);
  assert.equal(pptxResponse.headers.get("x-origin-artifact-verified"), "true");
  const pptxBytes = Buffer.from(await pptxResponse.arrayBuffer());
  assert.equal(pptxBytes.readUInt32LE(0), 0x04034b50);
  assert.ok(pptxBytes.includes(Buffer.from("FINAL_SENTINEL_21", "utf8")));
  assert.ok(pptxBytes.includes(Buffer.from("ppt/slides/slide3.xml", "utf8")));

  const xlsxResponse = await fetch(`${baseUrl}/api/artifacts/v1.2/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "xlsx",
      title: "売上集計",
      rows: [
        ["項目", "金額"],
        ["A", 1200],
        ["B", 1800],
        ["C", 2200],
        ["合計", { formula: "=SUM(B2:B4)", cachedValue: 5200 }],
      ],
    }),
  });
  assert.equal(xlsxResponse.status, 200);
  assert.equal(xlsxResponse.headers.get("x-origin-artifact-verified"), "true");
  const xlsxBytes = Buffer.from(await xlsxResponse.arrayBuffer());
  assert.equal(xlsxBytes.readUInt32LE(0), 0x04034b50);
  assert.ok(xlsxBytes.includes(Buffer.from("<f>SUM(B2:B4)</f><v>5200</v>", "utf8")));
  assert.ok(xlsxBytes.includes(Buffer.from('calcMode="auto"', "utf8")));

  console.log("Node production runtime smoke test passed.");
} finally {
  server.kill("SIGTERM");
}
