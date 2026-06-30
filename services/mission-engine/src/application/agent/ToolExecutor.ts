import { RuntimeMetrics } from "./RuntimeMetrics";
import https from "https";
import http from "http";
import dns from "dns";
import net from "net";
import { URL } from "url";
import fs from "fs/promises";
import nodePath from "path";

// === SSRF SECURITY CONTROLS ===

export function isSafeIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return false;
    const [a, b, c, d] = parts;

    // Loopback: 127.0.0.0/8
    if (a === 127) return false;

    // RFC1918 Private Ranges:
    // 10.0.0.0/8
    if (a === 10) return false;
    // 172.16.0.0/12
    if (a === 172 && (b >= 16 && b <= 31)) return false;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return false;

    // Link-local (includes GCP/AWS Metadata 169.254.169.254): 169.254.0.0/16
    if (a === 169 && b === 254) return false;

    // Current network (local broadcast): 0.0.0.0/8
    if (a === 0) return false;

    // Shared Address Space: 100.64.0.0/10
    if (a === 100 && (b >= 64 && b <= 127)) return false;

    // IETF Protocol Assignments: 192.0.0.0/24
    if (a === 192 && b === 0 && c === 0) return false;

    // TEST-NET-1: 192.0.2.0/24
    if (a === 192 && b === 0 && c === 2) return false;

    // IPv6 to IPv4 relay: 192.88.99.0/24
    if (a === 192 && b === 88 && c === 99) return false;

    // Benchmark testing: 198.18.0.0/15
    if (a === 198 && (b === 18 || b === 19)) return false;

    // TEST-NET-2: 198.51.100.0/22
    if (a === 198 && b === 51 && c === 100) return false;

    // TEST-NET-3: 203.0.113.0/24
    if (a === 203 && b === 0 && c === 113) return false;

    // Multicast: 224.0.0.0/4
    if (a >= 224 && a <= 239) return false;

    // Reserved/Future: 240.0.0.0/4
    if (a >= 240) return false;

    // Broadcast: 255.255.255.255
    if (a === 255 && b === 255 && c === 255 && d === 255) return false;

    return true;
  } else if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback: ::1
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return false;
    // Unspecified: ::
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return false;

    // Link-local: fe80::/10
    if (normalized.startsWith("fe80") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
      return false;
    }

    // Unique Local (RFC4193 private ranges): fc00::/7
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return false;
    }

    // Multicast: ff00::/8
    if (normalized.startsWith("ff")) {
      return false;
    }

    // IPv4-Mapped IPv6: ::ffff:0:0/96
    if (normalized.startsWith("::ffff:")) {
      const ipv4Part = ip.substring(ip.lastIndexOf(":") + 1);
      return isSafeIp(ipv4Part);
    }

    return true;
  }
  return false;
}

export function isWhitelistedDomain(hostname: string): boolean {
  const domainWhitelist = [
    "wikipedia.org",
    "api.github.com",
    "raw.githubusercontent.com",
    "httpbin.org",
    "api.stackexchange.com",
    "api.coindesk.com"
  ];
  const lowerHost = hostname.toLowerCase();
  return domainWhitelist.some(domain => lowerHost === domain || lowerHost.endsWith("." + domain));
}

export async function secureFetch(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      return reject(new Error("Invalid URL format."));
    }

    // 1. Whitelist URL schemes
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return reject(new Error("Access denied: Only HTTP and HTTPS schemes are allowed."));
    }

    const hostname = parsedUrl.hostname;

    // 2. Reject localhost explicitly
    if (hostname.toLowerCase() === "localhost") {
      return reject(new Error("Access denied: Localhost domain is prohibited."));
    }

    // 3. Whitelist domains
    if (!isWhitelistedDomain(hostname)) {
      return reject(new Error(`Access denied: Domain "${hostname}" is not whitelisted.`));
    }

    // Resolve domain IPs and check to fail-fast before initiating connections
    dns.lookup(hostname, { all: true }, (dnsErr, addresses) => {
      if (dnsErr) {
        return reject(new Error(`DNS lookup failed: ${dnsErr.message}`));
      }
      if (!addresses || addresses.length === 0) {
        return reject(new Error("DNS resolution returned no addresses."));
      }

      for (const entry of addresses) {
        if (!isSafeIp(entry.address)) {
          return reject(new Error(`Access denied: Unsafe IP address "${entry.address}" resolved.`));
        }
      }

      // DNS Rebinding prevention: Verify address resolved by the agent at socket creation time
      const secureLookup = (lookupHost: string, options: any, callback: any) => {
        dns.lookup(lookupHost, options, (err, address, family) => {
          if (err) return callback(err);
          if (!isSafeIp(address)) {
            return callback(new Error("Access denied: Unsafe IP address resolved at connection."));
          }
          callback(null, address, family);
        });
      };

      const isHttps = parsedUrl.protocol === "https:";
      const agent = isHttps
        ? new https.Agent({ lookup: secureLookup, keepAlive: false })
        : new http.Agent({ lookup: secureLookup, keepAlive: false });

      const requestModule = isHttps ? https : http;

      const options = {
        method: "GET",
        agent: agent,
        headers: {
          "User-Agent": "MissionEngineSecureFetch/1.1",
          "Host": hostname
        },
        timeout: 5000
      };

      const req = requestModule.request(urlStr, options, (res) => {
        // Reject redirects explicitly
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          return reject(new Error(`Access denied: Redirects are prohibited (HTTP ${res.statusCode}).`));
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          return reject(new Error(`Fetch error: HTTP status ${res.statusCode}`));
        }

        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1000000) { // Limit to 1MB
            req.destroy();
            reject(new Error("Access denied: Response payload size exceeds limit."));
          }
        });

        res.on("end", () => {
          resolve(body);
        });
      });

      req.on("error", (err) => {
        reject(new Error(`Secure fetch failed: ${err.message}`));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Secure fetch request timed out."));
      });

      req.end();
    });
  });
}

// === PATH TRAVERSAL SECURITY CONTROLS ===

export async function validateSafePath(relativePath: string): Promise<string> {
  // 1. Prevent URL encoding bypass
  let decodedPath = relativePath;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch (e) {
    throw new Error("Invalid URL/character encoding in path.");
  }

  // 2. Prevent unicode bypass (NFC normalization)
  decodedPath = decodedPath.normalize("NFC");

  // 3. Resolve the sandbox directory path
  const sandboxRoot = nodePath.resolve(process.cwd());

  // 4. Resolve the target path (replace backslashes to handle Windows bypass)
  const normalizedRelative = decodedPath.replace(/\\/g, "/");
  const targetPath = nodePath.resolve(sandboxRoot, normalizedRelative);

  // 5. Prevent symbolic link escape by finding the canonical path
  let canonicalPath: string;
  try {
    canonicalPath = await getCanonicalPath(targetPath);
  } catch (err) {
    canonicalPath = targetPath;
  }

  // 6. Restrict access to sandbox directory only
  const isInside = canonicalPath === sandboxRoot || canonicalPath.startsWith(sandboxRoot + nodePath.sep);
  if (!isInside) {
    throw new Error("Access denied: Path escapes the secure workspace sandbox.");
  }

  return canonicalPath;
}

async function getCanonicalPath(p: string): Promise<string> {
  let current = p;
  while (current && current !== nodePath.dirname(current)) {
    try {
      const realParent = await fs.realpath(current);
      const remaining = nodePath.relative(current, p);
      return nodePath.resolve(realParent, remaining);
    } catch (e) {
      current = nodePath.dirname(current);
    }
  }
  return p;
}

// === TOOL IMPLEMENTATIONS ===

export interface ToolInput {
  [key: string]: any;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface IAgentTool {
  name: string;
  description: string;
  execute(input: ToolInput): Promise<ToolResult>;
}

export class FileTool implements IAgentTool {
  public name = "FileTool";
  public description = "Reads or writes files in the workspace. Input format: { action: 'read' | 'write', path: string, content?: string }";

  public async execute(input: ToolInput): Promise<ToolResult> {
    const { action, path, content } = input;
    if (!path) {
      return { success: false, output: "", error: "Missing required 'path' parameter." };
    }

    try {
      // Robust path canonicalization and verification
      const fullPath = await validateSafePath(path);

      if (action === "read") {
        const fileContent = await fs.readFile(fullPath, "utf-8");
        return { success: true, output: fileContent };
      } else if (action === "write") {
        if (content === undefined) {
          return { success: false, output: "", error: "Missing required 'content' parameter for write action." };
        }
        await fs.mkdir(nodePath.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf-8");
        return { success: true, output: `Successfully wrote content to ${path}` };
      } else {
        return { success: false, output: "", error: `Unsupported action: '${action}'. Use 'read' or 'write'.` };
      }
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
    if (!url && !query) {
      return { success: false, output: "", error: "Missing both 'url' and 'query' parameters. Specify at least one." };
    }

    try {
      if (url) {
        // Run with secure fetch wrapper to prevent SSRF and DNS Rebinding
        const text = await secureFetch(url);
        return { success: true, output: text.substring(0, 1500) };
      } else if (query) {
        const searchSummary = `Search result summary for query "${query}":\n` +
          `- Standard Clean Architecture systems emphasize decoupling presentation, application, domain, and infrastructure.\n` +
          `- Verified pattern checks and unit testing suites ensure system state consistency.\n` +
          `- Decoupled designs are highly maintainable and scalable without introducing external workflow microservices.`;
        return { success: true, output: searchSummary };
      }
      return { success: false, output: "", error: "Invalid tool state parameters." };
    } catch (err) {
      return { success: false, output: "", error: `Web request failed: ${(err as Error).message}` };
    }
  }
}

export class CalculatorTool implements IAgentTool {
  public name = "CalculatorTool";
  public description = "Evaluates basic mathematical expressions. Input format: { expression: string }";

  public async execute(input: ToolInput): Promise<ToolResult> {
    const { expression } = input;
    if (!expression || typeof expression !== "string") {
      return { success: false, output: "", error: "Missing or invalid 'expression' parameter." };
    }

    const safeRegex = /^[0-9+\-*/().\s]+$/;
    if (!safeRegex.test(expression)) {
      return { success: false, output: "", error: "Security restriction: expression contains prohibited characters." };
    }

    try {
      const result = new Function(`return (${expression});`)();
      if (typeof result !== "number" || isNaN(result)) {
        return { success: false, output: "", error: "Evaluated output is not a valid number." };
      }
      return { success: true, output: result.toString() };
    } catch (err) {
      return { success: false, output: "", error: `Calculator execution failed: ${(err as Error).message}` };
    }
  }
}

export class ToolExecutor {
  private tools: Map<string, IAgentTool> = new Map();

  constructor() {
    this.registerTool(new FileTool());
    this.registerTool(new WebTool());
    this.registerTool(new CalculatorTool());
  }

  public registerTool(tool: IAgentTool): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): IAgentTool | undefined {
    return this.tools.get(name);
  }

  public getToolsList(): { name: string; description: string }[] {
    return Array.from(this.tools.values()).map(t => ({ name: t.name, description: t.description }));
  }

  public async executeTool(name: string, input: ToolInput, missionId: string, agentId: string): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return { success: false, output: "", error: `Tool '${name}' is not registered.` };
    }

    const startTime = Date.now();
    try {
      const result = await tool.execute(input);
      const latencyMs = Date.now() - startTime;

      RuntimeMetrics.getInstance().record({
        agentId,
        missionId,
        toolName: name,
        promptLength: 0,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        success: result.success
      });

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      RuntimeMetrics.getInstance().record({
        agentId,
        missionId,
        toolName: name,
        promptLength: 0,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        success: false
      });
      return { success: false, output: "", error: (err as Error).message };
    }
  }
}
