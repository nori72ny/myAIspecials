import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";

import { createOriginApp } from "./src/server/createOriginApp";

interface OriginWorkerBindings {
  OPENROUTER_API_KEY?: string;
  FREE_ONLY?: string;
  APP_URL?: string;
  ORIGIN_RELEASE_SHA?: string;
}

function createOriginWorkerEnvironment(
  bindings: OriginWorkerBindings,
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    OPENROUTER_API_KEY: bindings.OPENROUTER_API_KEY,
    FREE_ONLY: bindings.FREE_ONLY ?? "true",
    APP_URL: bindings.APP_URL,
    ORIGIN_RELEASE_SHA: bindings.ORIGIN_RELEASE_SHA,
  };
}

const app = createOriginApp(
  createOriginWorkerEnvironment(env as OriginWorkerBindings),
);

app.listen(3000);

export default httpServerHandler({ port: 3000 });
