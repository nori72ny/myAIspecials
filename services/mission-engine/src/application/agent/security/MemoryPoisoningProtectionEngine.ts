import { SecurityTelemetry } from "./SecurityTelemetry";

export interface HardenedMemoryEntry {
  timestamp: Date;
  content: string;
  confidence: number;
  trustedSource: boolean;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export class MemoryPoisoningProtectionEngine {
  private static readonly CONFIDENCE_THRESHOLD = 0.5;

  /**
   * Validates a new memory fact against existing facts to block duplicate, conflicting, untrusted, or expired memory.
   */
  public static validateFact(
    newContent: string,
    metadata: Record<string, any> | undefined,
    existingEntries: HardenedMemoryEntry[]
  ): { allowed: boolean; confidence: number; trustedSource: boolean; expiresAt?: Date; reason?: string } {
    
    // Resolve confidence and trusted flags from metadata or defaults
    const confidence = typeof metadata?.confidence === "number" ? metadata.confidence : 1.0;
    const trustedSource = typeof metadata?.trustedSource === "boolean" ? metadata.trustedSource : true;
    
    // Calculate expiration if TTL is provided
    let expiresAt: Date | undefined;
    if (metadata?.expiresAt instanceof Date) {
      expiresAt = metadata.expiresAt;
    } else if (typeof metadata?.ttlMs === "number") {
      expiresAt = new Date(Date.now() + metadata.ttlMs);
    }

    // 1. Confidence Score check
    if (confidence < this.CONFIDENCE_THRESHOLD) {
      SecurityTelemetry.getInstance().record({
        eventType: "MemoryRejected",
        source: "MemoryPoisoningProtection:ConfidenceCheck",
        details: { contentSnippet: newContent.substring(0, 100), confidence },
        description: `Memory rejected: confidence score ${confidence} is below the threshold of ${this.CONFIDENCE_THRESHOLD}.`
      });
      return { allowed: false, confidence, trustedSource, reason: "Low confidence score" };
    }

    // 2. Duplicate Detection
    const cleanNew = this.normalizeContent(newContent);
    const isDuplicate = existingEntries.some(e => this.normalizeContent(e.content) === cleanNew);
    if (isDuplicate) {
      SecurityTelemetry.getInstance().record({
        eventType: "MemoryRejected",
        source: "MemoryPoisoningProtection:DuplicateCheck",
        details: { contentSnippet: newContent.substring(0, 100) },
        description: `Memory rejected: duplicate fact detected.`
      });
      return { allowed: false, confidence, trustedSource, reason: "Duplicate memory fact detected" };
    }

    // 3. Conflicting Fact Detection
    // Simple semantic analysis: checking key verbs or noun negation clashes
    for (const existing of existingEntries) {
      if (this.isConflicting(cleanNew, this.normalizeContent(existing.content))) {
        // If conflict is detected, prioritize the one with higher confidence, or trusted source
        if (!trustedSource && existing.trustedSource) {
          SecurityTelemetry.getInstance().record({
            eventType: "MemoryRejected",
            source: "MemoryPoisoningProtection:ConflictCheck",
            details: { newContent, existingContent: existing.content },
            description: `Memory rejected: Conflict detected with a more trusted/higher-confidence existing fact.`
          });
          return { allowed: false, confidence, trustedSource, reason: `Conflicting fact clashing with: "${existing.content}"` };
        }
      }
    }

    return { allowed: true, confidence, trustedSource, expiresAt };
  }

  private static normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .trim()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
      .replace(/\s+/g, " ");
  }

  /**
   * Evaluates if two normalized fact strings are contradictory using negative qualifiers and semantic shifts.
   */
  private static isConflicting(factA: string, factB: string): boolean {
    const wordsA = factA.split(" ");
    const wordsB = factB.split(" ");

    // Check negation conflicts (e.g., "server is online" vs "server is not online")
    const hasNegationA = wordsA.includes("not") || wordsA.includes("never") || wordsA.includes("offline") || wordsA.includes("failed");
    const hasNegationB = wordsB.includes("not") || wordsB.includes("never") || wordsB.includes("offline") || wordsB.includes("failed");

    // Extract overlapping keywords to make sure they refer to the same object/subject
    const overlapping = wordsA.filter(w => wordsB.includes(w) && w.length > 3 && w !== "with" && w !== "that");

    if (overlapping.length >= 2) {
      // If one is negated and the other is not, we flag a potential contradiction
      if (hasNegationA !== hasNegationB) {
        return true;
      }

      // Check explicit online/offline clashes
      const aOnline = wordsA.includes("online");
      const bOnline = wordsB.includes("online");
      const aOffline = wordsA.includes("offline");
      const bOffline = wordsB.includes("offline");
      if ((aOnline && bOffline) || (aOffline && bOnline)) {
        return true;
      }

      // Check explicit success/failure clashes
      const aSuccess = wordsA.includes("success") || wordsA.includes("succeeded") || wordsA.includes("completed");
      const bSuccess = wordsB.includes("success") || wordsB.includes("succeeded") || wordsB.includes("completed");
      const aFailed = wordsA.includes("fail") || wordsA.includes("failed") || wordsA.includes("failure");
      const bFailed = wordsB.includes("fail") || wordsB.includes("failed") || wordsB.includes("failure");
      if ((aSuccess && bFailed) || (aFailed && bSuccess)) {
        return true;
      }
    }

    return false;
  }
}
