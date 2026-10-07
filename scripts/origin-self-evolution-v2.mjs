import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readBoundedResponseText, resolveCanonicalSource, sanitizeExternalEvidence } from "./origin-self-evolution-v2-source-safety.mjs";

const config = JSON.parse(readFileSync("config/origin-self-evolution-sources.json", "utf8"));
const maxExcerpt = Number(config.rules.maxExcerptChars || 1800);
const maxSources = Number(config.rules.maxSourcesPerRun || 40);
const maxSourceBytes = Number(config.rules.maxSourceBytes || 262144);
const scanMode = String(process.env.ORIGIN_SELF_EVOLUTION_SCAN_MODE || "hourly");
const VALID_SCAN_MODES = new Set(["hourly", "daily", "weekly", "all"]);
if (!VALID_SCAN_MODES.has(scanMode)) throw new Error("INVALID_SELF_EVOLUTION_SCAN_MODE");
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

async function fetchEvidence(category, source) {
  const canonical = resolveCanonicalSource(source);
  if (!canonical) {
    return {
      category: category.id,
      cadence: category.cadence,
      tier: source.tier,
      name: String(source.name || "unknown"),
      url: null,
      ok: false,
      status: 0,
      observedAt: new Date().toISOString(),
      lastModified: null,
      etag: null,
      fingerprint: null,
      excerpt: "",
      error: "SOURCE_CONFIGURATION_INVALID"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(canonical.url, {
      redirect: "error",
      signal: controller.signal,
      headers: {
        "User-Agent": "ORIGIN-Self-Evolution-V2/1.0",
        Accept: "text/html,application/json,text/plain;q=0.8,*/*;q=0.2"
      }
    });
    const declaredBytes = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxSourceBytes) throw new Error("SOURCE_BODY_TOO_LARGE");
    const text = await readBoundedResponseText(response, maxSourceBytes);
    const excerpt = sanitizeExternalEvidence(text, maxExcerpt);
    return {
      category: category.id,
      cadence: category.cadence,
      tier: source.tier,
      name: source.name,
      url: canonical.url,
      ok: response.ok,
      status: response.status,
      observedAt: new Date().toISOString(),
      lastModified: response.headers.get("last-modified"),
      etag: response.headers.get("etag"),
      fingerprint: excerpt ? sha256(excerpt) : null,
      excerpt
    };
  } catch {
    return {
      category: category.id,
      cadence: category.cadence,
      tier: source.tier,
      name: source.name,
      url: canonical.url,
      ok: false,
      status: 0,
      observedAt: new Date().toISOString(),
      lastModified: null,
      etag: null,
      fingerprint: null,
      excerpt: ""
    };
  } finally {
    clearTimeout(timer);
  }
}

function scoreObservation(item) {
  const evidenceStrength = item.tier === "A" ? 5 : item.tier === "B" ? 4 : item.tier === "C" ? 3 : 1;
  const urgency = item.category === "security" ? 5 : item.category === "ai-models" || item.category === "agents-coding" || item.category === "image-multimodal" ? 4 : 3;
  const actionable = item.ok && item.excerpt.length > 80 ? 2 : 0;
  return evidenceStrength * 10 + urgency * 4 + actionable;
}

function classify(item) {
  if (!item.ok) return "SOURCE_UNAVAILABLE";
  if (!item.fingerprint) return "NO_USABLE_EVIDENCE";
  if (item.tier === "A") return "PRIMARY_EVIDENCE";
  if (item.tier === "B") return "RESEARCH_SIGNAL";
  return "DISCOVERY_SIGNAL";
}

function buildHypotheses(observations) {
  return observations
    .filter((item) => item.ok && item.fingerprint)
    .sort((a, b) => scoreObservation(b) - scoreObservation(a))
    .slice(0, 12)
    .map((item) => ({
      id: sha256([item.category, item.name, item.fingerprint].join("|")).slice(0, 16),
      category: item.category,
      source: item.name,
      tier: item.tier,
      evidenceFingerprint: item.fingerprint,
      evidenceClass: classify(item),
      score: scoreObservation(item),
      status: "NEEDS_ORIGIN_BASELINE_COMPARISON",
      nextAction: item.tier === "A"
        ? "Compare this evidence against exact current ORIGIN capability and create a measurable improvement experiment only if a real gap exists."
        : "Use as a challenge signal; confirm with Tier A evidence before implementation."
    }));
}

const selected = [];
for (const category of config.categories) {
  if (scanMode !== "all" && category.cadence !== scanMode) continue;
  for (const source of category.sources) {
    if (selected.length >= maxSources) break;
    selected.push([category, source]);
  }
}
const observations = await Promise.all(selected.map(([category, source]) => fetchEvidence(category, source)));
const hypotheses = buildHypotheses(observations);
const generatedAt = new Date().toISOString();
const sha = process.env.GITHUB_SHA || "unknown";

const report = {
  schemaVersion: "origin.self-evolution.observation.v2",
  generatedAt,
  repository: process.env.GITHUB_REPOSITORY || "nori72ny/myAIspecials",
  sha,
  scanMode,
  invariant: {
    maxCostUsd: 0,
    paidFallback: false,
    automaticMerge: false,
    productionDeploy: false,
    externalEvidenceIsAuthority: false
  },
  summary: {
    attempted: observations.length,
    available: observations.filter((x) => x.ok).length,
    unavailable: observations.filter((x) => !x.ok).length,
    hypotheses: hypotheses.length
  },
  observations,
  hypotheses
};

writeFileSync("origin-self-evolution-v2.json", JSON.stringify(report, null, 2) + "\n");
writeFileSync("origin-self-evolution-v2.md", [
  "# ORIGIN Self-Evolution V2 Observation Report",
  "",
  `Generated: ${generatedAt}`,
  `Exact SHA: ${sha}`,
  `Scan mode: ${scanMode}`,
  `Sources: ${report.summary.available}/${report.summary.attempted} available`,
  `Improvement hypotheses: ${hypotheses.length}`,
  "",
  "External evidence is observation data, not authority. No code/model/secret/permission/deployment mutation is performed by this workflow.",
  "",
  ...hypotheses.map((h) => `- [${h.category}] ${h.source} — ${h.evidenceClass} — score ${h.score} — ${h.status}`)
].join("\n") + "\n");

console.log(JSON.stringify({ ok: true, sha, summary: report.summary }));
