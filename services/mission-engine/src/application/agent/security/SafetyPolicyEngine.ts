import { isSafeIp, isWhitelistedDomain } from "../ToolExecutor";
import { SecurityTelemetry } from "./SecurityTelemetry";
import { URL } from "url";

export type SafetyDecision = "ALLOW" | "BLOCK" | "REVIEW";

export interface SafetyCheckInput {
  toolName?: string;
  toolInput?: any;
  targetUrl?: string;
  filePath?: string;
  outputPayload?: string;
  executionHistory?: string[];
  missionId?: string;
  taskId?: string;
}

export class SafetyPolicyEngine {
  // Disallowed critical configuration or executable files
  private static readonly DANGEROUS_FILE_PATTERNS = [
    /\.env/i,
    /package(-lock)?\.json/i,
    /\.gitignore/i,
    /node_modules/i,
    /\.github/i,
    /\.sh$/i,
    /\.bat$/i,
    /\.exe$/i,
    /\.bin$/i,
    /etc\/passwd/i,
    /etc\/hosts/i,
    /\.git/i
  ];

  // Shell script execution patterns, command injection risk keywords
  private static readonly UNSAFE_OUTPUT_PATTERNS = [
    /rm\s+-rf/i,
    /chmod\s+\+x/i,
    /curl\s+[^|]+\|\s*sh/i,
    /wget\s+[^|]+\|\s*sh/i,
    /DROP\s+TABLE/i,
    /UNION\s+SELECT/i,
    /;\s*(eval|exec|system|spawn)\s*\(/i
  ];

  public static evaluate(input: SafetyCheckInput): SafetyDecision {
    const { toolName, toolInput, targetUrl, filePath, outputPayload, executionHistory, missionId, taskId } = input;

    // 1. Check Dangerous Tool Usage
    if (toolName) {
      if (toolName === "FileTool" && toolInput) {
        const path = toolInput.path || "";
        if (this.isDangerousFile(path)) {
          SecurityTelemetry.getInstance().record({
            eventType: "UnsafeActionBlocked",
            source: "SafetyPolicyEngine:FileCheck",
            details: { toolName, path, missionId, taskId },
            description: `Unsafe action blocked: Attempt to access dangerous file path "${path}" via FileTool.`
          });
          return "BLOCK";
        }
      }

      if (toolName === "WebTool" && toolInput) {
        const urlStr = toolInput.url;
        if (urlStr) {
          const decision = this.evaluateUrl(urlStr, missionId, taskId);
          if (decision === "BLOCK") return "BLOCK";
        }
      }
    }

    // 2. Direct URL evaluation
    if (targetUrl) {
      const decision = this.evaluateUrl(targetUrl, missionId, taskId);
      if (decision === "BLOCK") return "BLOCK";
    }

    // 3. Direct File path evaluation
    if (filePath) {
      if (this.isDangerousFile(filePath)) {
        SecurityTelemetry.getInstance().record({
          eventType: "UnsafeActionBlocked",
          source: "SafetyPolicyEngine:FileCheck",
          details: { filePath, missionId, taskId },
          description: `Unsafe action blocked: Attempt to access dangerous file path "${filePath}".`
        });
        return "BLOCK";
      }
    }

    // 4. Recursive Execution Check
    if (executionHistory && executionHistory.length > 0) {
      // If we see the same action pattern repeating excessively (more than 5 times in a cycle)
      const actionCounts: Record<string, number> = {};
      for (const act of executionHistory) {
        actionCounts[act] = (actionCounts[act] || 0) + 1;
        if (actionCounts[act] >= 5) {
          SecurityTelemetry.getInstance().record({
            eventType: "UnsafeActionBlocked",
            source: "SafetyPolicyEngine:RecursionCheck",
            details: { action: act, count: actionCounts[act], missionId, taskId },
            description: `Recursive execution loop detected: Action "${act}" executed ${actionCounts[act]} times. Breaking execution cycle.`
          });
          return "BLOCK";
        }
      }
    }

    // 5. Unsafe Output Payload evaluation
    if (outputPayload) {
      for (const pattern of this.UNSAFE_OUTPUT_PATTERNS) {
        if (pattern.test(outputPayload)) {
          SecurityTelemetry.getInstance().record({
            eventType: "UnsafeActionBlocked",
            source: "SafetyPolicyEngine:OutputCheck",
            details: { pattern: pattern.toString(), missionId, taskId },
            description: `Unsafe output blocked: Matched dangerous output signature "${pattern.toString()}"`
          });
          return "REVIEW"; // Unsafe outputs can trigger human review or warning
        }
      }
    }

    return "ALLOW";
  }

  private static isDangerousFile(path: string): boolean {
    if (!path) return false;
    const cleanPath = path.replace(/\\/g, "/");
    return this.DANGEROUS_FILE_PATTERNS.some(pattern => pattern.test(cleanPath));
  }

  private static evaluateUrl(urlStr: string, missionId?: string, taskId?: string): SafetyDecision {
    try {
      const parsed = new URL(urlStr);
      // Scheme constraint
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        SecurityTelemetry.getInstance().record({
          eventType: "UnsafeActionBlocked",
          source: "SafetyPolicyEngine:UrlCheck",
          details: { urlStr, protocol: parsed.protocol, missionId, taskId },
          description: `Access blocked: URL protocol "${parsed.protocol}" is not allowed.`
        });
        return "BLOCK";
      }

      // Whitelisted domain
      const hostname = parsed.hostname;
      if (!isWhitelistedDomain(hostname)) {
        SecurityTelemetry.getInstance().record({
          eventType: "UnsafeActionBlocked",
          source: "SafetyPolicyEngine:UrlCheck",
          details: { urlStr, hostname, missionId, taskId },
          description: `Access blocked: Domain "${hostname}" is not on the whitelist.`
        });
        return "BLOCK";
      }

      // Reject non-standard ports to prevent port-scanning or internal service attacks
      if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
        SecurityTelemetry.getInstance().record({
          eventType: "UnsafeActionBlocked",
          source: "SafetyPolicyEngine:UrlCheck",
          details: { urlStr, port: parsed.port, missionId, taskId },
          description: `Access blocked: Non-standard port "${parsed.port}" in URL.`
        });
        return "BLOCK";
      }

      return "ALLOW";
    } catch (e) {
      SecurityTelemetry.getInstance().record({
        eventType: "UnsafeActionBlocked",
        source: "SafetyPolicyEngine:UrlCheck",
        details: { urlStr, error: (e as Error).message, missionId, taskId },
        description: `Access blocked: Malformed URL configuration.`
      });
      return "BLOCK";
    }
  }
}
