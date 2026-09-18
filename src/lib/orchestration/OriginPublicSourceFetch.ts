import { createHash } from "node:crypto";
import https from "node:https";

import {
  resolveOriginPublicNetworkTarget,
  type OriginDnsResolver,
  type OriginResolvedAddress,
} from "./OriginPublicNetworkPolicy.js";

const MAX_SOURCE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface OriginFetchedPublicSource {
  finalUrl: string;
  fetchedAt: string;
  httpStatus: 200;
  contentType: string;
  contentDigest: string;
  body: string;
  pinnedAddress: OriginResolvedAddress;
  networkPolicy: {
    publicAddressOnly: true;
    redirectsFollowed: false;
    dnsPinned: true;
  };
}

export interface OriginPinnedFetchTransport {
  (
    url: string,
    pinnedAddress: OriginResolvedAddress,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<{
    status: number;
    headers: Readonly<Record<string, string | string[] | undefined>>;
    body: Buffer;
  }>;
}

export type OriginPublicSourceFetchResult =
  | { ok: true; value: OriginFetchedPublicSource }
  | {
      ok: false;
      code:
        | "PUBLIC_SOURCE_NETWORK_REJECTED"
        | "PUBLIC_SOURCE_FETCH_FAILED"
        | "PUBLIC_SOURCE_REDIRECT_REJECTED"
        | "PUBLIC_SOURCE_HTTP_STATUS_REJECTED"
        | "PUBLIC_SOURCE_TOO_LARGE"
        | "PUBLIC_SOURCE_CONTENT_TYPE_REJECTED";
    };

function allowedContentType(value: string): boolean {
  const normalized = value.toLowerCase().split(";")[0].trim();
  return normalized === "text/html"
    || normalized === "text/plain"
    || normalized === "application/json"
    || normalized === "application/xhtml+xml";
}

const defaultTransport: OriginPinnedFetchTransport = (
  rawUrl,
  pinnedAddress,
  timeoutMs,
  maxBytes,
) => new Promise((resolve, reject) => {
  const url = new URL(rawUrl);
  const request = https.request({
    protocol: "https:",
    hostname: url.hostname,
    port: 443,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    servername: url.hostname,
    timeout: timeoutMs,
    headers: {
      accept: "text/html,text/plain,application/json,application/xhtml+xml",
      "accept-encoding": "identity",
      "user-agent": "ORIGIN-Public-Source-Verifier/1.0",
    },
    lookup: (_hostname, _options, callback) => {
      callback(null, pinnedAddress.address, pinnedAddress.family);
    },
  }, (response) => {
    const chunks: Buffer[] = [];
    let total = 0;

    response.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        request.destroy(new Error("PUBLIC_SOURCE_TOO_LARGE"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    response.on("end", () => {
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      });
    });
  });

  request.on("timeout", () => request.destroy(new Error("PUBLIC_SOURCE_TIMEOUT")));
  request.on("error", reject);
  request.end();
});

export async function fetchOriginPublicSource(
  rawUrl: string,
  options: {
    resolver?: OriginDnsResolver;
    transport?: OriginPinnedFetchTransport;
    timeoutMs?: number;
    maxBytes?: number;
    now?: () => number;
  } = {},
): Promise<OriginPublicSourceFetchResult> {
  const resolution = await resolveOriginPublicNetworkTarget(rawUrl, options.resolver);
  if (!resolution.ok) return { ok: false, code: "PUBLIC_SOURCE_NETWORK_REJECTED" };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > 15_000
    || !Number.isInteger(maxBytes)
    || maxBytes < 1_024
    || maxBytes > MAX_SOURCE_BYTES
  ) {
    return { ok: false, code: "PUBLIC_SOURCE_FETCH_FAILED" };
  }

  const pinnedAddress = resolution.addresses[0];
  const transport = options.transport ?? defaultTransport;

  let response;
  try {
    response = await transport(resolution.url, pinnedAddress, timeoutMs, maxBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "PUBLIC_SOURCE_TOO_LARGE") {
      return { ok: false, code: "PUBLIC_SOURCE_TOO_LARGE" };
    }
    return { ok: false, code: "PUBLIC_SOURCE_FETCH_FAILED" };
  }

  if (response.status >= 300 && response.status < 400) {
    return { ok: false, code: "PUBLIC_SOURCE_REDIRECT_REJECTED" };
  }
  if (response.status !== 200) {
    return { ok: false, code: "PUBLIC_SOURCE_HTTP_STATUS_REJECTED" };
  }
  if (response.body.length > maxBytes) {
    return { ok: false, code: "PUBLIC_SOURCE_TOO_LARGE" };
  }

  const rawContentType = response.headers["content-type"];
  const contentType = Array.isArray(rawContentType) ? rawContentType[0] ?? "" : rawContentType ?? "";
  if (!allowedContentType(contentType)) {
    return { ok: false, code: "PUBLIC_SOURCE_CONTENT_TYPE_REJECTED" };
  }

  const body = response.body.toString("utf8");
  const digest = createHash("sha256").update(response.body).digest("hex");
  const now = options.now ?? Date.now;

  return {
    ok: true,
    value: Object.freeze({
      finalUrl: resolution.url,
      fetchedAt: new Date(now()).toISOString(),
      httpStatus: 200 as const,
      contentType,
      contentDigest: `sha256:${digest}`,
      body,
      pinnedAddress: Object.freeze({ ...pinnedAddress }),
      networkPolicy: Object.freeze({
        publicAddressOnly: true as const,
        redirectsFollowed: false as const,
        dnsPinned: true as const,
      }),
    }),
  };
}
