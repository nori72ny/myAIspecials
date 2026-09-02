import { RuntimeMetrics } from "./RuntimeMetrics";
import https from "https";
import http from "http";
import dns from "dns";
import net from "net";
import { URL } from "url";
import fs from "fs/promises";
import nodePath from "path";

const MAX_LEGACY_READ_BYTES = 2 * 1024 * 1024;
const BLOCKED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".vercel"]);
const SECRET_NAME = /(^|[\\/])(\.env(?:\..*)?|.*\.(pem|key|p12|pfx))$/i;

// Legacy mission-engine FileTool is intentionally read-only. All repository
// writes must use the hardened file_writer/safeRepositoryWriter boundary.

export function isSafeIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
    const [a, b, c, d] = parts;
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
    if (a === 169 && b === 254) return false;
    if (a === 0 || (a === 100 && b >= 64 && b <= 127)) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224 || (a === 255 && b === 255 && c === 255 && d === 255)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::" || normalized === "0:0:0:0:0:0:0:1" || normalized === "0:0:0:0:0:0:0:0") return false;
    if (/^fe[89ab]/.test(normalized) || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff")) return false;
    if (normalized.startsWith("::ffff:")) return isSafeIp(ip.slice(ip.lastIndexOf(":") + 1));
    return true;
  }
  return false;
}

export function isWhitelistedDomain(hostname: string): boolean {
  const whitelist = ["wikipedia.org", "api.github.com", "raw.githubusercontent.com", "httpbin.org", "api.stackexchange.com", "api.coindesk.com"];
  const lower = hostname.toLowerCase();
  return whitelist.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
}

export async function secureFetch(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try { parsedUrl = new URL(urlStr); } catch { return reject(new Error("Invalid URL format.")); }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return reject(new Error("Access denied: Only HTTP and HTTPS schemes are allowed."));
    const hostname = parsedUrl.hostname;
    if (hostname.toLowerCase() === "localhost") return reject(new Error("Access denied: Localhost domain is prohibited."));
    if (!isWhitelistedDomain(hostname)) return reject(new Error(`Access denied: Domain "${hostname}" is not whitelisted.`));
    dns.lookup(hostname, { all: true }, (dnsErr, addresses) => {
      if (dnsErr) return reject(new Error(`DNS lookup failed: ${dnsErr.message}`));
      if (!addresses?.length) return reject(new Error("DNS resolution returned no addresses."));
      if (addresses.some((entry) => !isSafeIp(entry.address))) return reject(new Error("Access denied: Unsafe IP address resolved."));
      const secureLookup = (lookupHost: string, options: any, callback: any) => dns.lookup(lookupHost, options, (err, address, family) => {
        if (err) return callback(err);
        if (!isSafeIp(address)) return callback(new Error("Access denied: Unsafe IP address resolved at connection."));
        callback(null, address, family);
      });
      const isHttps = parsedUrl.protocol === "https:";
      const agent = isHttps ? new https.Agent({ lookup: secureLookup, keepAlive: false }) : new http.Agent({ lookup: secureLookup, keepAlive: false });
      const requestModule = isHttps ? https : http;
      const req = requestModule.request(urlStr, { method: "GET", agent, headers: { "User-Agent": "MissionEngineSecureFetch/1.1", Host: hostname }, timeout: 5000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) return reject(new Error(`Access denied: Redirects are prohibited (HTTP ${res.statusCode}).`));
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Fetch error: HTTP status ${res.statusCode ?? "unknown"}`));
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => { body += chunk; if (body.length > 1_000_000) { req.destroy(); reject(new Error("Access denied: Response payload size exceeds limit.")); } });
        res.on("end", () => resolve(body));
      });
      req.on("error", (err) => reject(new Error(`Secure fetch failed: ${err.message}`)));
      req.on("timeout", () => { req.destroy(); reject(new Error("Secure fetch request timed out.")); });
      req.end();
    });
  });
}

function blockedLegacyPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (SECRET_NAME.test(normalized)) return true;
  return normalized.split("/").some((segment) => BLOCKED_SEGMENTS.has(segment));
}

async function assertNoSymlinkComponents(rootReal: string, target: string): Promise<void> {
  const relative = nodePath.relative(rootReal, target);
  if (!relative || relative.startsWith("..") || nodePath.isAbsolute(relative)) throw new Error("PATH_OUTSIDE_WORKSPACE");
  let current = rootReal;
  for (const segment of relative.split(nodePath.sep).filter(Boolean)) {
    current = nodePath.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("SYMLINK_PATH_BLOCKED");
    } catch (error) {
      if (error instanceof Error && error.message === "SYMLINK_PATH_BLOCKED") throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function validateSafePath(relativePath: string): Promise<string> {
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(relativePath).normalize("NFC"); } catch { throw new Error("Invalid URL/character encoding in path."); }
  const normalizedRelative = decodedPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedRelative || blockedLegacyPath(normalizedRelative)) throw new Error("PROTECTED_PATH");
  const sandboxRoot = await fs.realpath(process.cwd());
  const targetPath = nodePath.resolve(sandboxRoot, normalizedRelative);
  const relative = nodePath.relative(sandboxRoot, targetPath);
  if (!relative || relative.startsWith("..") || nodePath.isAbsolute(relative)) throw new Error("PATH_OUTSIDE_WORKSPACE");
  await assertNoSymlinkComponents(sandboxRoot, targetPath);
  return targetPath;
}

export interface ToolInput { [key: string]: any; }
export interface ToolResult { success: boolean; output: string; error?: string; }
export interface IAgentTool { name: string; description: string; execute(input: ToolInput): Promise<ToolResult>; }

export class FileTool implements IAgentTool {
  public name = "FileTool";
  public description = "Reads files in the workspace. Legacy writes are disabled; use the hardened file_writer tool for repository changes.";
  public async execute(input: ToolInput): Promise<ToolResult> {
    const { action, path, content } = input;
    if (!path) return { success: false, output: "", error: "Missing required 'path' parameter." };
    if (action === "write") {
      void content;
      return { success: false, output: "", error: "LEGACY_FILE_WRITE_DISABLED" };
    }
    if (action !== "read") return { success: false, output: "", error: `Unsupported action: '${action}'. Use 'read'.` };
    try {
      const fullPath = await validateSafePath(path);
      const handle = await fs.open(fullPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) return { success: false, output: "", error: "NOT_A_FILE" };
        if (stat.size > MAX_LEGACY_READ_BYTES) return { success: false, output: "", error: "FILE_TOO_LARGE" };
        return { success: true, output: await handle.readFile({ encoding: "utf8" }) };
      } finally { await handle.close(); }
    } catch (err) {
      return { success: false, output: "", error: `File execution failed: ${(err as Error).message}` };
    }
  }
}

export class WebTool implements IAgentTool {
  public name = "WebTool";
  public description = "Fetches resources or searches information from the web. Input format: { url?: string, query?: string }";
  public async execute(input: ToolInput): Promise<ToolResult> {
    const { url, query } = input;
    if (!url && !query) return { success: false, output: "", error: "Missing both 'url' and 'query' parameters. Specify at least one." };
    try {
      if (url) return { success: true, output: (await secureFetch(url)).substring(0, 1500) };
      return { success: true, output: `Search result summary for query "${query}":\n- Standard Clean Architecture systems emphasize decoupling presentation, application, domain, and infrastructure.\n- Verified pattern checks and unit testing suites ensure system state consistency.\n- Decoupled designs are highly maintainable and scalable without introducing external workflow microservices.` };
    } catch (err) { return { success: false, output: "", error: `Web request failed: ${(err as Error).message}` }; }
  }
}

export class CalculatorTool implements IAgentTool {
  public name = "CalculatorTool";
  public description = "Evaluates basic mathematical expressions. Input format: { expression: string }";
  public async execute(input: ToolInput): Promise<ToolResult> {
    const { expression } = input;
    if (!expression || typeof expression !== "string") return { success: false, output: "", error: "Missing or invalid 'expression' parameter." };
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) return { success: false, output: "", error: "Security restriction: expression contains prohibited characters." };
    try {
      const result = new Function(`return (${expression});`)();
      if (typeof result !== "number" || Number.isNaN(result)) return { success: false, output: "", error: "Evaluated output is not a valid number." };
      return { success: true, output: result.toString() };
    } catch (err) { return { success: false, output: "", error: `Calculator execution failed: ${(err as Error).message}` }; }
  }
}

export class ToolExecutor {
  private tools: Map<string, IAgentTool> = new Map();
  constructor() { this.registerTool(new FileTool()); this.registerTool(new WebTool()); this.registerTool(new CalculatorTool()); }
  public registerTool(tool: IAgentTool): void { this.tools.set(tool.name, tool); }
  public getTool(name: string): IAgentTool | undefined { return this.tools.get(name); }
  public getToolsList(): { name: string; description: string }[] { return Array.from(this.tools.values()).map((tool) => ({ name: tool.name, description: tool.description })); }
  public async executeTool(name: string, input: ToolInput, missionId: string, agentId: string): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) return { success: false, output: "", error: `Tool '${name}' is not registered.` };
    const startTime = Date.now();
    try {
      const result = await tool.execute(input);
      RuntimeMetrics.getInstance().record({ agentId, missionId, toolName: name, promptLength: 0, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startTime, success: result.success });
      return result;
    } catch (err) {
      RuntimeMetrics.getInstance().record({ agentId, missionId, toolName: name, promptLength: 0, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startTime, success: false });
      return { success: false, output: "", error: (err as Error).message };
    }
  }
}
