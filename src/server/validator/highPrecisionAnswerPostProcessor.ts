export class HighPrecisionAnswerPostProcessor {
  public static process(rawContent: string, options: { requireRawJson?: boolean; forbiddenWords?: string[] } = {}): string {
    if (!rawContent || !rawContent.trim()) throw new Error("EMPTY_RESPONSE");
    let cleaned = rawContent.trim();
    if (options.requireRawJson) {
      const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      cleaned = match ? match[1].trim() : cleaned;
      JSON.parse(cleaned);
    }
    if (options.forbiddenWords) {
      for (const w of options.forbiddenWords) {
        if (cleaned.includes(w)) throw new Error(`FORBIDDEN_WORD: ${w}`);
      }
    }
    return cleaned;
  }
}
