import { PromptInjectionFirewall } from "./PromptInjectionFirewall";
import { SecurityTelemetry } from "./SecurityTelemetry";

export class ToolOutputSanitizer {
  /**
   * Sanitizes the tool output to protect against injection and escape sequences before entering prompt builders.
   */
  public static sanitize(rawOutput: string, toolName: string = "unknown"): string {
    if (!rawOutput) {
      return "";
    }

    let sanitized = rawOutput;

    // 1. Unicode Normalization (NFC) & Clean hidden control characters
    sanitized = sanitized.normalize("NFC");
    // Strip zero-width spaces and invisible formatting characters
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
    // Replace non-breaking spaces with standard space
    sanitized = sanitized.replace(/[\u00A0]/g, " ");

    // 2. Remove Embedded Role Tags & prompt structure indicators FIRST (to preserve custom tags before HTML stripping)
    const roleTags = [
      /\[SYSTEM\]/gi,
      /\[USER\]/gi,
      /\[ASSISTANT\]/gi,
      /\[DEVELOPER\]/gi,
      /<system>/gi,
      /<\/system>/gi,
      /<user>/gi,
      /<\/user>/gi,
      /<assistant>/gi,
      /<\/assistant>/gi,
      /<<<<\s*SYSTEM_CONTEXT_START\s*>>>>/gi,
      /<<<<\s*SYSTEM_CONTEXT_END\s*>>>>/gi,
      /<<<<\s*USER_CONTEXT_START\s*>>>>/gi,
      /<<<<\s*USER_CONTEXT_END\s*>>>>/gi,
      /\[Fact\s+\d+\]/gi,
      /###\s+\d+\.\s+全体ミッション目的/g,
      /###\s+\d+\.\s+割り当てられた個別タスク/g
    ];

    for (const tag of roleTags) {
      if (tag.test(sanitized)) {
        sanitized = sanitized.replace(tag, "[ROLE_TAG_REMOVED]");
      }
    }

    // 3. HTML script/style content and tag removal
    // First, recursively remove style and script blocks with their contents
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "[SCRIPT_BLOCKED]");
    sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "[STYLE_BLOCKED]");
    sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "[IFRAME_BLOCKED]");
    
    // Strip all remaining HTML tags
    sanitized = sanitized.replace(/<\/?[a-z][^>]*>/gi, "");

    // 4. Markdown Normalization
    // Strip suspicious markdown links containing protocol execution tricks
    sanitized = sanitized.replace(/\[([^\]]*)\]\((javascript|data|vbscript|file):[^)]*\)/gi, "[$1]([BLOCKED_URI])");
    
    // Normalize Markdown markers to avoid system prompt parsing breakages
    sanitized = sanitized.replace(/#{1,6}\s+/g, (match) => {
      // Degrade heading tags in tool outputs to simple bullet or text style to avoid header hijacking
      return "• ";
    });

    // 5. Run through Prompt Injection Firewall
    const firewallResult = PromptInjectionFirewall.analyze(sanitized, `Tool:${toolName}`);
    if (firewallResult.classification === "Malicious") {
      SecurityTelemetry.getInstance().record({
        eventType: "ToolSanitized",
        source: `Tool:${toolName}`,
        details: { action: "BLOCK_AND_ALERT", originalLength: rawOutput.length },
        description: `Tool output from ${toolName} contained highly malicious instructions and was fully neutralized.`
      });
      return `[WARNING: Tool output blocked due to potential prompt injection or security concerns]`;
    } else if (firewallResult.classification === "Suspicious") {
      SecurityTelemetry.getInstance().record({
        eventType: "ToolSanitized",
        source: `Tool:${toolName}`,
        details: { action: "SANITIZE", originalLength: rawOutput.length },
        description: `Tool output from ${toolName} contained suspicious patterns and was sanitized.`
      });
      sanitized = firewallResult.sanitizedContent;
    }

    // Trace successful sanitation if modified
    if (sanitized !== rawOutput) {
      SecurityTelemetry.getInstance().record({
        eventType: "ToolSanitized",
        source: `Tool:${toolName}`,
        details: { sanitizedLength: sanitized.length, originalLength: rawOutput.length },
        description: `Tool output from ${toolName} sanitized successfully.`
      });
    }

    return sanitized;
  }
}
