import { pathToFileURL } from "node:url";

export const FULL_LOWERCASE_GIT_SHA = /^[0-9a-f]{40}$/;

export function assertOriginReleaseSha(candidate) {
  if (!FULL_LOWERCASE_GIT_SHA.test(candidate ?? "")) {
    throw new Error(
      "ORIGIN_RELEASE_SHA must be the exact 40-character lowercase Git commit SHA",
    );
  }

  return candidate;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assertOriginReleaseSha(process.argv[2] ?? process.env.ORIGIN_RELEASE_SHA);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid ORIGIN_RELEASE_SHA");
    process.exitCode = 1;
  }
}
