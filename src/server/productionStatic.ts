import type { RequestHandler } from "express";
import path from "node:path";

function decodeRecursively(str: string): string {
  let current = str;
  for (let i = 0; i < 5; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

export function isBlockedStaticArtifact(targetPath: string): boolean {
  if (!targetPath) return false;

  // Strip query strings and fragments
  const cleanPath = targetPath.split("?")[0].split("#")[0];

  // Decode URL encoding iteratively
  const decodedPath = decodeRecursively(cleanPath);

  // Normalize slashes and path
  const normalizedPath = path.posix.normalize(decodedPath.replace(/\\/g, "/")).toLowerCase();

  // Extract filename / basename
  const filename = path.posix.basename(normalizedPath);

  // Check if filename is server.cjs
  if (filename === "server.cjs") {
    return true;
  }

  // Check if filename ends with .map
  if (filename.endsWith(".map")) {
    return true;
  }

  // Check individual path segments
  const segments = normalizedPath.split("/");
  for (const segment of segments) {
    if (segment === "server.cjs" || segment.endsWith(".map")) {
      return true;
    }
  }

  return false;
}

export const productionStaticProtection: RequestHandler = (req, res, next) => {
  const rawPaths = [req.path, req.url, req.originalUrl].filter((p): p is string => Boolean(p));

  for (const rawPath of rawPaths) {
    if (isBlockedStaticArtifact(rawPath)) {
      res.status(404).json({
        code: "NOT_FOUND",
        message: "リクエストされたリソースが見つかりません。",
      });
      return;
    }
  }

  next();
};
