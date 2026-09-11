import "dotenv/config";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";

type OriginAppLoader = () => Promise<Express>;

let originAppPromise: Promise<Express> | undefined;

async function loadOriginApp(): Promise<Express> {
  // Vercel emits the TypeScript dependency graph as Node ESM. Keep runtime
  // specifiers on emitted .js paths; TypeScript/esbuild resolve them back to
  // the .ts sources during local checks and bundling.
  originAppPromise ??= Promise.all([
    import("../src/server/createOriginApp.js"),
    import("../src/agent/codingSchemaBootstrapV14.js"),
  ]).then(async ([{ createOriginApp }, { bootstrapCodingSchemaV14 }]) => {
    const bootstrap = await bootstrapCodingSchemaV14(process.env);
    if (bootstrap.status === "failed") {
      // Never emit database URLs, exception messages, SQL, or environment data.
      console.error("ORIGIN_CODING_SCHEMA_BOOTSTRAP_FAILED", { code: bootstrap.code });
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
