import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const CHAT_WINDOW_MS = 60_000;
const CHAT_REQUEST_LIMIT = 60;
const CHAT_BURST_CAPACITY = 8;
const CHAT_CONCURRENCY_LIMIT = 2;
const MAX_RATE_BUCKETS = 10_000;

interface RateBucket {
  tokens: number;
  lastRefillAt: number;
  active: number;
}

function jsonError(
  res: Response,
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return res.status(status).json({
    code,
    message,
    retryable,
    requestId: "UNKNOWN",
  });
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function applyOriginSecurityHeaders(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction): void => {
  const isProduction = env.NODE_ENV === "production";
  const scriptSources = isProduction
    ? "'self'"
    : "'self' 'unsafe-inline' 'unsafe-eval'";
  const connectSources = isProduction
    ? "'self'"
    : "'self' ws: wss:";

  const isolatedArtifactRuntime = req.path === "/origin-artifact-sandbox.html";
  const contentSecurityPolicy = isolatedArtifactRuntime
    ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
    : [
      "default-src 'self'",
      `script-src ${scriptSources}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSources}`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; ");

  res.setHeader("Content-Security-Policy", contentSecurityPolicy);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }

  next();
  };
}

export function requireSafeOriginChatRequest(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "POST") {
      next();
      return;
    }

    if (!req.is(["application/json", "application/*+json"])) {
      jsonError(
        res,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "チャットAPIはJSON形式のリクエストだけを受け付けます。",
      );
      return;
    }

    const requestOrigin = safeOrigin(req.get("origin"));
    if (req.get("origin") && !requestOrigin) {
      jsonError(res, 403, "CROSS_ORIGIN_REQUEST_BLOCKED", "許可されていない送信元です。");
      return;
    }

    const configuredOrigin = safeOrigin(env.APP_URL);
    const requestHost = req.get("host");
    const sameHost = requestOrigin && requestHost
      ? new URL(requestOrigin).host === requestHost
      : false;
    const configuredMatch = requestOrigin && configuredOrigin
      ? requestOrigin === configuredOrigin
      : false;

    if (requestOrigin && !sameHost && !configuredMatch) {
      jsonError(res, 403, "CROSS_ORIGIN_REQUEST_BLOCKED", "許可されていない送信元です。");
      return;
    }

    next();
  };
}

export function createOriginChatRateLimiter(now: () => number = Date.now) {
  const buckets = new Map<string, RateBucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "POST") {
      next();
      return;
    }

    const clientAddress = req.ip || req.socket.remoteAddress || "unknown";
    const key = createHash("sha256").update(clientAddress).digest("hex");
    const currentTime = now();
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = { tokens: CHAT_BURST_CAPACITY, lastRefillAt: currentTime, active: 0 };
      buckets.set(key, bucket);
    }

    const elapsedMs = Math.max(0, currentTime - bucket.lastRefillAt);
    const refill = (elapsedMs / CHAT_WINDOW_MS) * CHAT_REQUEST_LIMIT;
    bucket.tokens = Math.min(CHAT_BURST_CAPACITY, bucket.tokens + refill);
    bucket.lastRefillAt = currentTime;

    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((1 - bucket.tokens) / CHAT_REQUEST_LIMIT) * CHAT_WINDOW_MS / 1_000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      jsonError(
        res,
        429,
        "CHAT_RATE_LIMITED",
        "短時間の依頼が集中しています。少し待ってから再度お試しください。",
        true,
      );
      return;
    }

    if (bucket.active >= CHAT_CONCURRENCY_LIMIT) {
      res.setHeader("Retry-After", "2");
      jsonError(
        res,
        429,
        "CHAT_CONCURRENCY_LIMITED",
        "現在ほかの回答を処理中です。完了後に再度お試しください。",
        true,
      );
      return;
    }

    bucket.tokens -= 1;
    bucket.active += 1;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const activeBucket = buckets.get(key);
      if (activeBucket) activeBucket.active = Math.max(0, activeBucket.active - 1);
    };
    res.once("finish", release);
    res.once("close", release);

    if (buckets.size > MAX_RATE_BUCKETS) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (oldestKey && oldestKey !== key) buckets.delete(oldestKey);
    }

    next();
  };
}
