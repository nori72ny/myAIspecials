import "dotenv/config";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { resolveCodingDatabaseUrlV14 } from "../src/agent/codingDatabaseUrlV14.js";
import { bootstrapCodingSchemaV14 } from "../src/agent/codingSchemaBootstrapV14.js";

type OriginAppLoader = () => Promise<Express>;

let originAppPromise: Promise<Express> | undefined;

async function loadOriginApp(): Promise<Express> {
  // The bootstrap module is now self-contained and bundle-safe. Import it
  // statically so Vercel does not need to resolve a second runtime dynamic
  // module URL. The guarded database operation itself remains isolated below.
  originAppPromise ??= import("../src/server/createOriginApp.js").then(async ({ createOriginApp }) => {
    try {
      const database = resolveCodingDatabaseUrlV14(process.env);
      const bootstrapEnv = database
        ? { ...process.env, POSTGRES_URL: database.connectionString }
        : process.env;
      const bootstrap = await bootstrapCodingSchemaV14(bootstrapEnv);
      if (bootstrap.status === "failed") {
        // Never emit database URLs, exception messages, SQL, or environment data.
        console.error("ORIGIN_CODING_SCHEMA_BOOTSTRAP_FAILED", { code: bootstrap.code });
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code.slice(0, 80)
        : "CODING_SCHEMA_BOOTSTRAP_EXECUTION_FAILED";
      console.error("ORIGIN_CODING_SCHEMA_BOOTSTRAP_FAILED", { code });
    }
    return createOriginApp();
  });
  return originAppPromise;
}

export function createVercelHandler(loadApp: OriginAppLoader = loadOriginApp) {
  return async function originVercelHandler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const app = await loadApp();
      app(request, response);
    } catch (error) {
      const diagnostic = error && typeof error === "object"
        ? {
            name: "name" in error && typeof error.name === "string"
              ? error.name.slice(0, 80)
              : "Error",
            code: "code" in error && typeof error.code === "string"
              ? error.code.slice(0, 80)
              : "ORIGIN_FUNCTION_INIT_FAILED",
          }
        : { name: "Error", code: "ORIGIN_FUNCTION_INIT_FAILED" };

      // Deliberately exclude the exception message, stack, environment, request
      // headers, and body. Vercel logs receive only a bounded error class/code.
      console.error("ORIGIN_FUNCTION_INIT_FAILED", diagnostic);

      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          code: "ORIGIN_FUNCTION_INIT_FAILED",
          message: "ORIGIN APIの初期化に失敗しました。",
          retryable: false,
          requestId: "UNKNOWN",
        }));
      }
    }
  };
}

export default createVercelHandler();
