import { SecurityTelemetry } from "./SecurityTelemetry";

export type InjectionClassification = "Safe" | "Suspicious" | "Malicious";
export type FirewallAction = "ALLOW" | "SANITIZE" | "REJECT";

export interface FirewallResult {
  classification: InjectionClassification;
  action: FirewallAction;
  sanitizedContent: string;
  reason?: string;
}

export class PromptInjectionFirewall {
  // Strong indicators that represent a clear attempt to bypass safety or hijack the agent instructions
  private static readonly MALICIOUS_PATTERNS = [
    /ignore[\s-_]*previous[\s-_]*instructions/i,
    /ignore[\s-_]*the[\s-_]*instructions[\s-_]*above/i,
    /ignore[\s-_]*all[\s-_]*prior[\s-_]*prompts/i,
    /reveal[\s-_]*system[\s-_]*prompt/i,
    /reveal[\s-_]*instructions/i,
    /reveal[\s-_]*your[\s-_]*system/i,
    /output[\s-_]*system[\s-_]*prompt/i,
    /show[\s-_]*system[\s-_]*instructions/i,
    /tell[\s-_]*me[\s-_]*your[\s-_]*system[\s-_]*prompt/i,
    /override[\s-_]*mission/i,
    /override[\s-_]*system/i,
    /override[\s-_]*instructions/i,
    /disregard[\s-_]*restrictions/i,
    /disregard[\s-_]*safety/i,
    /bypass[\s-_]*restrictions/i,
    /jailbreak/i,
    /do[\s-_]*anything[\s-_]*now/i,
    /dan[\s-_]*mode/i,
    /system[\s-_]*override/i,
    /new[\s-_]*mission[\s-_]*objective/i,
    /Ignore system instructions/i
  ];

  // Weak indicators that are sometimes normal conversational flow but could be part of an attempt
  private static readonly SUSPICIOUS_PATTERNS = [
    /you[\s-_]*are[\s-_]*now[\s-_]*a/i,
    /you[\s-_]*must[\s-_]*act[\s-_]*as/i,
    /roleplay[\s-_]*as/i,
    /execute[\s-_]*command/i,
    /sudo\b/i,
    /stop[\s-_]*the[\s-_]*mission/i,
    /forget[\s-_]*what[\s-_]*I[\s-_]*said/i
  ];

  public static analyze(content: string, source: string = "unknown"): FirewallResult {
    if (!content) {
      return { classification: "Safe", action: "ALLOW", sanitizedContent: "" };
    }

    // NFC normalize and remove lookalike/homoglyph trick indicators or control characters
    const normalized = content.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Check malicious patterns
    for (const pattern of this.MALICIOUS_PATTERNS) {
      if (pattern.test(normalized)) {
        SecurityTelemetry.getInstance().record({
          eventType: "PromptInjectionDetected",
          source,
          details: { pattern: pattern.toString(), contentSnippet: normalized.substring(0, 100) },
          description: `Malicious prompt injection attempt blocked: matched pattern ${pattern.toString()}`
        });

        return {
          classification: "Malicious",
          action: "REJECT",
          sanitizedContent: "",
          reason: `Malicious input blocked: prompt injection detected.`
        };
      }
    }

    // Check suspicious patterns
    let isSuspicious = false;
    let matchedSuspicious: string[] = [];
    let sanitized = normalized;

    for (const pattern of this.SUSPICIOUS_PATTERNS) {
      if (pattern.test(normalized)) {
        isSuspicious = true;
        matchedSuspicious.push(pattern.toString());
        // Sanitize by replacing suspicious phrase with an alert block
        sanitized = sanitized.replace(pattern, "[SUSPICIOUS_PHRASE_REMOVED]");
      }
    }

    if (isSuspicious) {
      SecurityTelemetry.getInstance().record({
        eventType: "PromptInjectionDetected",
        source,
        details: { patterns: matchedSuspicious, contentSnippet: normalized.substring(0, 100) },
        description: `Suspicious prompt injection pattern neutralized: ${matchedSuspicious.join(", ")}`
      });

      return {
        classification: "Suspicious",
        action: "SANITIZE",
        sanitizedContent: sanitized,
        reason: `Suspicious patterns neutralized: ${matchedSuspicious.join(", ")}`
      };
    }

    return {
      classification: "Safe",
      action: "ALLOW",
      sanitizedContent: content
    };
  }
}
