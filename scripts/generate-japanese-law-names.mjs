#!/usr/bin/env node
/**
 * Regenerates src/lib/orchestration/japaneseLawNames.ts from the official
 * e-Gov 法令API (no key, no registration, no cost).
 *
 * Source: GET https://laws.e-gov.go.jp/api/1/lawlists/2
 *   法令種別 2 = 憲法・法律 (the Constitution and statutes enacted by the
 *   Diet). Cabinet orders (政令) and ministerial ordinances (省令・規則)
 *   are intentionally out of scope: answer text cites them almost always
 *   as 「〇〇法施行令」「〇〇法施行規則」, and the publication gate checks
 *   those by stripping the 施行令／施行規則 suffix and looking up the base
 *   statute, which is in this list.
 *
 * The XML carries one <LawNameListInfo> per law with a <LawName> element.
 * For older statutes the LawName is the promulgation citation form
 * 「昭和二十二年法律第五十四号（私的独占の禁止及び公正取引の確保に関する法律）」;
 * the parenthesised part is the actual statute name, so it is extracted
 * as an additional entry.
 *
 * Usage: node scripts/generate-japanese-law-names.mjs
 * Output is deterministic: de-duplicated and sorted by code point.
 */
import { writeFile } from "node:fs/promises";

const SOURCE_URL = "https://laws.e-gov.go.jp/api/1/lawlists/2";
const OUTPUT_PATH = new URL("../src/lib/orchestration/japaneseLawNames.ts", import.meta.url);

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`e-Gov law list fetch failed: HTTP ${response.status}`);
const xml = await response.text();

const names = new Set();
for (const match of xml.matchAll(/<LawName>([^<]+)<\/LawName>/g)) {
  const raw = match[1].trim();
  if (!raw) continue;
  names.add(raw);
  const parenthesised = /^.+?（(.+)）$/.exec(raw);
  if (parenthesised) names.add(parenthesised[1]);
}
const sorted = [...names].sort();
if (sorted.length < 1000) throw new Error(`suspiciously few law names parsed: ${sorted.length}`);

const retrievedDate = new Date().toISOString().slice(0, 10);
const body = `/**
 * Static list of current Japanese statute names (憲法・法律), bundled for
 * the direct-answer publication gate's deterministic law-name check
 * (EXTERNAL_CONSULT_STALE_ADOPTION_2026-11-17, adoption 2).
 *
 * Source: e-Gov 法令API (デジタル庁), GET ${SOURCE_URL}
 *   (法令種別 2 = 憲法・法律; free, no key, no registration).
 * Retrieved: ${retrievedDate}. Entries: ${sorted.length} (de-duplicated;
 * promulgation-citation forms such as 「昭和二十二年法律第五十四号（…）」
 * contribute their parenthesised statute name as an extra entry).
 * Scope limit: 政令・省令・規則 are not included; the gate checks
 * 「〇〇法施行令／施行規則」 by its base statute name instead.
 * Regenerate with: node scripts/generate-japanese-law-names.mjs
 */
export const JAPANESE_LAW_LIST_SOURCE = "e-Gov 法令API lawlists/2 (憲法・法律)";
export const JAPANESE_LAW_LIST_RETRIEVED_AT = "${retrievedDate}";
export const JAPANESE_LAW_NAMES: readonly string[] = [
${sorted.map((name) => `  ${JSON.stringify(name)},`).join("\n")}
];
`;
await writeFile(OUTPUT_PATH, body, "utf8");
console.log(`wrote ${sorted.length} law names to ${OUTPUT_PATH.pathname}`);
