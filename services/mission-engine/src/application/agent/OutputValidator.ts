export type OutputFormat = "JSON" | "Markdown" | "Text";

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  parsedContent?: any;
}

export class OutputValidator {
  public static validate(content: string, format: OutputFormat): ValidationResult {
    if (!content || content.trim() === "") {
      return { isValid: false, error: "エージェントの出力が空、または空白のみです。" };
    }

    if (format === "JSON") {
      try {
        let cleanContent = content.trim();
        // Strip markdown blocks if they are wrapping the JSON
        if (cleanContent.startsWith("```json")) {
          cleanContent = cleanContent.replace(/^```json/, "").replace(/```$/, "").trim();
        } else if (cleanContent.startsWith("```")) {
          cleanContent = cleanContent.replace(/^```/, "").replace(/```$/, "").trim();
        }
        
        const parsed = JSON.parse(cleanContent);
        return { isValid: true, parsedContent: parsed };
      } catch (err) {
        return { isValid: false, error: `JSONパースに失敗しました: ${(err as Error).message}` };
      }
    }

    if (format === "Markdown") {
      const hasHeaders = /^#+\s+/m.test(content);
      const hasLists = /^[-*+]\s+/m.test(content) || /^\d+\.\s+/m.test(content);
      const hasFormatting = /\*\*|__|\*|_|`/.test(content);

      if (!hasHeaders && !hasLists && !hasFormatting) {
        return {
          isValid: false,
          error: "Markdown形式が期待されましたが、見出し、リスト、または太字などのMarkdown構文が検出されませんでした。"
        };
      }
      return { isValid: true };
    }

    return { isValid: true };
  }
}
