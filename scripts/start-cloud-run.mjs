import { readFileSync } from "node:fs";

import { assertOriginProductionEnv } from "./assert-origin-production-env.mjs";

const imageReleaseSha = readFileSync(
  process.env.ORIGIN_IMAGE_RELEASE_SHA_FILE ?? "ORIGIN_RELEASE_SHA",
  "utf8",
);

assertOriginProductionEnv({ imageReleaseSha });
await import("../dist/server.cjs");
