import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { assertOriginReleaseSha } from "./assert-origin-release-sha.mjs";

const FORBIDDEN_RUNTIME_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ORIGIN_AI_STUDIO_API_KEY",
  "ORIGIN_AI_STUDIO_RUNTIME_ENABLED",
  "ORIGIN_AI_STUDIO_OWNER_APPROVED",
  "VERCEL_GIT_COMMIT_SHA",
];

export function assertOriginProductionEnv({
  env = process.env,
  imageReleaseSha,
} = {}) {
  const runtimeReleaseSha = assertOriginReleaseSha(env.ORIGIN_RELEASE_SHA);
  const immutableImageReleaseSha = assertOriginReleaseSha(imageReleaseSha);

  if (runtimeReleaseSha !== immutableImageReleaseSha) {
    throw new Error("Runtime release SHA does not match the immutable image release SHA");
  }

  if (env.NODE_ENV !== "production") {
    throw new Error("NODE_ENV must be production");
  }

  if (env.FREE_ONLY !== "true") {
    throw new Error("FREE_ONLY must be true");
  }

  if (!env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY must be provided by the runtime secret manager");
  }

  for (const key of FORBIDDEN_RUNTIME_KEYS) {
    if (env[key]?.trim()) {
      throw new Error(`${key} is forbidden in the ORIGIN production runtime`);
    }
  }

  return runtimeReleaseSha;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const imageReleaseSha = readFileSync(
      process.env.ORIGIN_IMAGE_RELEASE_SHA_FILE ?? "ORIGIN_RELEASE_SHA",
      "utf8",
    );
    assertOriginProductionEnv({ imageReleaseSha });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid production environment");
    process.exitCode = 1;
  }
}
