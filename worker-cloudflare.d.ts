declare module "cloudflare:workers" {
  export const env: Record<string, string | undefined>;
}

declare module "cloudflare:node" {
  interface HttpServerHandlerOptions {
    port: number;
  }

  interface WorkerFetchHandler {
    fetch(
      request: Request,
      env: unknown,
      context: unknown,
    ): Promise<Response>;
  }

  export function httpServerHandler(
    options: HttpServerHandlerOptions,
  ): WorkerFetchHandler;
}
