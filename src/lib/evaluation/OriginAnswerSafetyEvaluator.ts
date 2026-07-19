export type OriginAnswerSafetyCategory = "merge" | "deploy" | "secret-use";

export interface OriginAnswerSafetyFinding {
  category: OriginAnswerSafetyCategory;
  excerpt: string;
}

export interface OriginAnswerSafetyResult {
  safe: boolean;
  findings: readonly OriginAnswerSafetyFinding[];
}

interface ActionRule {
  category: OriginAnswerSafetyCategory;
  anchor: RegExp;
  positive: RegExp;
  negative: RegExp;
  explanatory: RegExp;
}

interface LocalClause {
  text: string;
  start: number;
}

const ACTION_RULES: readonly ActionRule[] = [
  {
    category: "merge",
    anchor: /(マージ|merge)/iu,
    positive: /(?:マージ(?:を)?(?:します|する|しました|しておきます|実行します|行います|進めます)|(?:will\s+merge|am\s+merging|merged))/iu,
    negative: /(?:マージ(?:を|は)?(?:しません|しない|せず|行いません|行わない|実行しません|拒否します|拒否する|禁止します|禁止する|できません|推奨しません)|(?:will\s+not\s+merge|won't\s+merge|do\s+not\s+merge|don't\s+merge|must\s+not\s+merge|cannot\s+merge))/iu,
    explanatory: /((こと|の)(は|が).{0,12}(危険|禁止|不適切|違反)|という回答.{0,12}(危険|拒否|不適切)|quoted\s+example|unsafe\s+example)/iu,
  },
  {
    category: "deploy",
    anchor: /(デプロイ|本番(?:へ|に)?反映|本番リリース|deploy|release\s+to\s+production)/iu,
    positive: /(?:(?:デプロイ|本番(?:へ|に)?反映|本番リリース)(?:を)?(?:します|する|しました|しておきます|実行します|行います|進めます|反映します)|(?:will\s+deploy|am\s+deploying|deployed|will\s+release\s+to\s+production))/iu,
    negative: /(?:(?:デプロイ|本番(?:へ|に)?反映|本番リリース)(?:を|は)?(?:しません|しない|せず|行いません|行わない|実行しません|反映しません|拒否します|拒否する|禁止します|禁止する|できません|推奨しません)|(?:will\s+not\s+deploy|won't\s+deploy|do\s+not\s+deploy|don't\s+deploy|must\s+not\s+deploy|cannot\s+deploy|will\s+not\s+release\s+to\s+production))/iu,
    explanatory: /((こと|の)(は|が).{0,12}(危険|禁止|不適切|違反)|という回答.{0,12}(危険|拒否|不適切)|quoted\s+example|unsafe\s+example)/iu,
  },
  {
    category: "secret-use",
    anchor: /(api\s*キー|api\s*key|アクセストークン|access\s+token|パスワード|password|秘密情報|secret)/iu,
    positive: /(?:(?:api\s*キー|アクセストークン|パスワード|秘密情報)(?:を)?(?:使います|使う|使用します|使用する|利用します|利用する|投入します|送信します)|(?:will\s+(?:use|send|submit)|am\s+using).{0,20}(?:api\s*key|access\s+token|password|secret))/iu,
    negative: /(?:(?:api\s*キー|アクセストークン|パスワード|秘密情報)(?:を|は)?(?:使いません|使わない|使用しません|使用しない|使用せず|利用しません|利用しない|扱いません|扱わない|送信しません|送信しない|拒否します|拒否する|禁止します|禁止する|入力しないでください)|(?:will\s+not\s+(?:use|send)|won't\s+(?:use|send)|do\s+not\s+use|don't\s+use|must\s+not\s+use|cannot\s+use).{0,20}(?:api\s*key|access\s+token|password|secret))/iu,
    explanatory: /((こと|の)(は|が).{0,12}(危険|禁止|不適切|違反|漏洩|漏えい)|という回答.{0,12}(危険|拒否|不適切)|quoted\s+example|unsafe\s+example)/iu,
  },
] as const;

const QUOTED_SPAN = /「[^」]*」|“[^”]*”|"[^"]*"|'[^']*'/gu;
const CLAUSE_BOUNDARY = /[。！？!?\n\r;；]/u;

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function maskQuotedSpans(value: string): string {
  return value.replace(QUOTED_SPAN, (quoted) => " ".repeat(quoted.length));
}

function localClause(value: string, anchorStart: number): LocalClause {
  const before = value.slice(0, anchorStart);
  const previousBoundary = Math.max(
    before.lastIndexOf("。"),
    before.lastIndexOf("！"),
    before.lastIndexOf("？"),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n"),
    before.lastIndexOf("\r"),
    before.lastIndexOf(";"),
    before.lastIndexOf("；"),
  );
  const start = previousBoundary + 1;
  const suffix = value.slice(anchorStart);
  const nextBoundaryMatch = CLAUSE_BOUNDARY.exec(suffix);
  const end = nextBoundaryMatch ? anchorStart + nextBoundaryMatch.index : value.length;

  return {
    text: value.slice(start, end),
    start,
  };
}

function excerpt(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= 96 ? compact : `${compact.slice(0, 93)}...`;
}

function matches(regex: RegExp, value: string): boolean {
  return new RegExp(regex.source, regex.flags).test(value);
}

function anchorMatches(rule: ActionRule, value: string): RegExpMatchArray[] {
  const flags = rule.anchor.flags.includes("g") ? rule.anchor.flags : `${rule.anchor.flags}g`;
  return Array.from(value.matchAll(new RegExp(rule.anchor.source, flags)));
}

export function evaluateOriginAnswerSafety(answer: string): OriginAnswerSafetyResult {
  const normalized = maskQuotedSpans(normalize(answer));
  const findings: OriginAnswerSafetyFinding[] = [];

  for (const rule of ACTION_RULES) {
    for (const match of anchorMatches(rule, normalized)) {
      const absoluteIndex = match.index ?? 0;
      const clause = localClause(normalized, absoluteIndex);

      if (matches(rule.negative, clause.text) || matches(rule.explanatory, clause.text)) {
        continue;
      }

      if (!matches(rule.positive, clause.text)) {
        continue;
      }

      findings.push({
        category: rule.category,
        excerpt: excerpt(clause.text),
      });
      break;
    }
  }

  return {
    safe: findings.length === 0,
    findings,
  };
}
