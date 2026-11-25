import { describe, expect, it, vi } from "vitest";
import {
  isSelfContainedCodeTaskRequest,
  originChatSystemInstruction,
  originCloudflareRouteSystemInstruction,
  originGroqRouteSystemInstruction,
  requiresOriginGroundedResearch,
  requiresOriginGroundedResearchRouted,
  resolveOriginCodeTaskRoutingMode,
} from "./originChatResponsePolicy";
import { classifyOriginRequestIntent } from "../lib/orchestration/OriginRequestIntent";

// CB-1 / CB-3 (CODEBENCH_REMAINING_DIAGNOSIS_2026-11-23): self-contained
// code tasks — code pasted by the user plus an operation request on it —
// were promoted to the grounded path because the routing patterns scan
// the pasted code itself and its identifiers (`price`, a `tax`
// variable, a 消費税 comment) collide with the freshness vocabulary.
// The grounded synthesis then honestly refused (its sources do not
// describe the user's code) and the answer carried no code block at
// all: codebench C-05 and E-05 (B-01 at its 2026-11-20 measurement).
// The exemption judges the PROSE only and is gated by
// ORIGIN_CODE_TASK_ROUTING_MODE (default off); CB-3 adds the
// defining-behavior rule to the base instruction and pins it in the
// route-2 compact variant.

// The exact prompts measured by codebench (tasks.json), verbatim.
const B01_PROMPT = "次のPythonコードにはバグがあります。バグを特定し、修正したコード全体をコードブロックで返してください。何がバグだったかの説明も簡潔に付けてください。なお、空のリストの平均は 0 を返す仕様にしてください。\n\n```python\ndef add_price(price, prices=[]):\n    prices.append(price)\n    return prices\n\ndef average_price(prices):\n    return sum(prices) / len(prices)\n```";
const C05_PROMPT = "次のPythonコードを、動作を変えずにリファクタリングしてください。検証・金額計算・文字列整形をそれぞれ別の関数に分け、process_order はそれらを組み合わせるだけにしてください。返り値の文字列の形式は変えないでください。修正後のコード全体をコードブロックで返してください。変更のポイントも簡潔に説明してください。\n\n```python\ndef process_order(order):\n    if not order.get('items'):\n        return 'error: no items'\n    total = 0\n    for item in order['items']:\n        total += item['price'] * item['qty']\n    tax = total * 0.1\n    total_with_tax = total + tax\n    name = order.get('customer', 'unknown')\n    return f\"{name}: total={total_with_tax:.0f} yen (tax {tax:.0f} yen)\"\n```";
const E05_PROMPT = "次のPythonコードをレビューしてください。性能上の問題点があれば、理由と、結果が同じになる改善コードを示してください。\n\n```python\ndef order_totals(db):\n    orders = db.execute('SELECT id FROM orders').fetchall()\n    result = []\n    for (order_id,) in orders:\n        rows = db.execute('SELECT price, qty FROM items WHERE order_id = ?', (order_id,)).fetchall()\n        result.append((order_id, sum(p * q for p, q in rows)))\n    return result\n```";

describe("isSelfContainedCodeTaskRequest", () => {
  it("matches the C-05 refactor request (price / tax live only inside the code)", () => {
    expect(isSelfContainedCodeTaskRequest(C05_PROMPT)).toBe(true);
  });

  it("matches the E-05 review request (the SQL price column is inside the fence)", () => {
    expect(isSelfContainedCodeTaskRequest(E05_PROMPT)).toBe(true);
  });

  it("matches the B-01 bug-fix shape", () => {
    expect(isSelfContainedCodeTaskRequest(B01_PROMPT)).toBe(true);
  });

  it("matches when the colliding vocabulary sits in an in-code comment only", () => {
    const message = "次のコードをレビューしてください。\n\n```python\n# 消費税込みの金額を返す\ndef total_with_tax(price):\n    return price * 1.1\n```";
    expect(isSelfContainedCodeTaskRequest(message)).toBe(true);
  });

  it("matches an English review request over pasted code", () => {
    const message = "Please review the following code and suggest improvements:\n\n```js\nconst total = items.reduce((sum, item) => sum + item.price, 0);\n```";
    expect(isSelfContainedCodeTaskRequest(message)).toBe(true);
  });

  it("does not match when the prose itself asks for current external facts alongside the code", () => {
    const message = "次のコードを修正してください。あわせて最新の価格を調べてください。\n\n```python\ndef add_price(price, prices=[]):\n    prices.append(price)\n    return prices\n```";
    expect(isSelfContainedCodeTaskRequest(message)).toBe(false);
  });

  it("does not match the latest-version how-to shape (freshness intent in the prose)", () => {
    const message = "次のコードの最新バージョンでの書き方を教えてください。\n\n```python\nprint('hello')\n```";
    expect(isSelfContainedCodeTaskRequest(message)).toBe(false);
  });

  it("does not match a plain question without any fenced code", () => {
    expect(isSelfContainedCodeTaskRequest("JavaScriptの async/await と Promise の関係を説明してください。")).toBe(false);
    expect(isSelfContainedCodeTaskRequest("現在の最低賃金はいくらですか？")).toBe(false);
  });

  it("does not match a fenced block the prose does not operate on", () => {
    const message = "今日の東京の天気はどうですか？\n\n```\n参考メモ\n```";
    expect(isSelfContainedCodeTaskRequest(message)).toBe(false);
  });

  it("does not match an unclosed fence", () => {
    const message = "次のコードを修正してください。\n\n```python\ndef add_price(price):\n    return price";
    expect(isSelfContainedCodeTaskRequest(message)).toBe(false);
  });
});

describe("resolveOriginCodeTaskRoutingMode", () => {
  it("defaults to off unless the env value is exactly 'shadow' or 'enforce'", () => {
    expect(resolveOriginCodeTaskRoutingMode(undefined)).toBe("off");
    expect(resolveOriginCodeTaskRoutingMode({})).toBe("off");
    expect(resolveOriginCodeTaskRoutingMode({ ORIGIN_CODE_TASK_ROUTING_MODE: "off" })).toBe("off");
    expect(resolveOriginCodeTaskRoutingMode({ ORIGIN_CODE_TASK_ROUTING_MODE: "true" })).toBe("off");
    expect(resolveOriginCodeTaskRoutingMode({ ORIGIN_CODE_TASK_ROUTING_MODE: "SHADOW" })).toBe("off");
    expect(resolveOriginCodeTaskRoutingMode({ ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginCodeTaskRoutingMode({ ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" })).toBe("enforce");
  });
});

describe("requiresOriginGroundedResearchRouted (CB-1)", () => {
  it("is exactly the canonical determination while the switch is off (the default)", () => {
    // The canonical determination still promotes the measured code
    // tasks today; with the switch off nothing changes.
    expect(requiresOriginGroundedResearch(C05_PROMPT)).toBe(true);
    expect(requiresOriginGroundedResearch(E05_PROMPT)).toBe(true);
    for (const message of [C05_PROMPT, E05_PROMPT, B01_PROMPT, "今日のニュースを教えて", "メールの書き方を教えて"]) {
      expect(requiresOriginGroundedResearchRouted(message, { env: {} as NodeJS.ProcessEnv })).toBe(
        requiresOriginGroundedResearch(message),
      );
    }
  });

  it("shadow mode logs the comparison and still routes exactly as before", () => {
    const logger = vi.fn();
    const routed = requiresOriginGroundedResearchRouted(C05_PROMPT, {
      env: { ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" } as NodeJS.ProcessEnv,
      logger,
    });
    expect(routed).toBe(requiresOriginGroundedResearch(C05_PROMPT));
    expect(logger).toHaveBeenCalledTimes(1);
    const fields = logger.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.codeTaskRequestMatched).toBe(true);
    expect(fields.groundedResearchRequired).toBe(true);
    expect(fields.codeTaskWouldExempt).toBe(true);
    // Booleans only — the log never carries the message text.
    expect(Object.values(fields).every((value) => typeof value === "boolean")).toBe(true);
    // The line itself is a single JSON-bearing string, so the field
    // names sit in the message text where log text search reaches
    // them (the 2026-11-23 shadow window found no line at all when
    // the fields rode only in the second argument).
    const line = logger.mock.calls[0][0] as string;
    expect(line.startsWith("[origin-chat] code task routing (shadow) {")).toBe(true);
    expect(JSON.parse(line.slice(line.indexOf("{")))).toEqual(fields);
    expect(line).not.toContain("process_order");
  });

  it("shadow mode logs every determination, including predicate misses", () => {
    // A miss line is what makes the mode itself observable: without
    // it, a silent window cannot distinguish "off" from "no match"
    // (the 2026-11-23 production shadow window hit exactly that).
    const logger = vi.fn();
    const message = "現在の最低賃金はいくらですか？";
    const routed = requiresOriginGroundedResearchRouted(message, {
      env: { ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" } as NodeJS.ProcessEnv,
      logger,
    });
    expect(routed).toBe(requiresOriginGroundedResearch(message));
    expect(logger).toHaveBeenCalledTimes(1);
    const fields = logger.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.codeTaskRequestMatched).toBe(false);
    expect(fields.groundedResearchRequired).toBe(true);
    expect(fields.codeTaskWouldExempt).toBe(false);
    const line = logger.mock.calls[0][0] as string;
    expect(JSON.parse(line.slice(line.indexOf("{")))).toEqual(fields);
  });

  it("off and enforce modes never log", () => {
    const offLogger = vi.fn();
    requiresOriginGroundedResearchRouted(C05_PROMPT, {
      env: {} as NodeJS.ProcessEnv,
      logger: offLogger,
    });
    expect(offLogger).not.toHaveBeenCalled();
    const enforceLogger = vi.fn();
    requiresOriginGroundedResearchRouted(C05_PROMPT, {
      env: { ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv,
      logger: enforceLogger,
    });
    expect(enforceLogger).not.toHaveBeenCalled();
  });

  it("enforce mode keeps the measured code tasks on the direct path", () => {
    const env = { ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv;
    expect(requiresOriginGroundedResearchRouted(C05_PROMPT, { env })).toBe(false);
    expect(requiresOriginGroundedResearchRouted(E05_PROMPT, { env })).toBe(false);
    expect(requiresOriginGroundedResearchRouted(B01_PROMPT, { env })).toBe(false);
  });

  it("enforce mode leaves non-code-task routing untouched", () => {
    const env = { ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv;
    // A freshness question still grounds, with or without a stray fence.
    expect(requiresOriginGroundedResearchRouted("現在の最低賃金はいくらですか？", { env })).toBe(true);
    expect(requiresOriginGroundedResearchRouted("今日の東京の天気はどうですか？\n\n```\n参考メモ\n```", { env })).toBe(
      requiresOriginGroundedResearch("今日の東京の天気はどうですか？\n\n```\n参考メモ\n```"),
    );
    // An explicit research request still grounds.
    expect(requiresOriginGroundedResearchRouted("最新の経済指標を検索して調べてください", { env })).toBe(true);
    // A plain writing request keeps the canonical result.
    expect(requiresOriginGroundedResearchRouted("メールの書き方を教えて", { env })).toBe(
      requiresOriginGroundedResearch("メールの書き方を教えて"),
    );
  });

  it("enforce mode does not exempt a code task whose prose demands current facts", () => {
    const env = { ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv;
    const message = "次のコードを修正してください。あわせて最新の価格を調べてください。\n\n```python\ndef add_price(price, prices=[]):\n    prices.append(price)\n    return prices\n```";
    expect(requiresOriginGroundedResearchRouted(message, { env })).toBe(true);
  });
});

describe("defining-behavior rule (CB-3)", () => {
  const PHRASE = "state each asked-about concept's defining behavior explicitly as a sentence";

  it("states the general rule in the full base instruction", () => {
    const instruction = originChatSystemInstruction();
    expect(instruction).toContain(PHRASE);
    expect(instruction).toContain("what it returns, what it does, and what it does not do");
    // The rule is general (concept explanations), not async-specific.
    expect(instruction).toContain("When explaining a concept or mechanism");
  });

  it("keeps the rule for a plain conversational question (it is not creation-gated)", () => {
    const intent = classifyOriginRequestIntent("日本の首都はどこですか？", "review");
    expect(intent.interactionMode).toBe("conversation");
    expect(originChatSystemInstruction(intent)).toContain(PHRASE);
  });

  it("carries the rule in the route-2 compact variant (registered in the compact base)", () => {
    const variant = originCloudflareRouteSystemInstruction(originChatSystemInstruction());
    expect(variant).toContain(PHRASE);
    expect(variant).toContain("what it returns, what it does, and what it does not do");
  });
});

describe("confusion-point supplement and code-handling rules (CB-4)", () => {
  const SUPPLEMENT = "Where a concept has a well-known point of confusion";
  const EQUIVALENCE = "first trace what the original code actually does";
  const DEFINITION_USE = "use every name exactly as it was defined";

  it("states the supplement and both general rules in the full base instruction", () => {
    const instruction = originChatSystemInstruction();
    expect(instruction).toContain(SUPPLEMENT);
    expect(instruction).toContain("name that point explicitly");
    expect(instruction).toContain(EQUIVALENCE);
    expect(instruction).toContain("never attribute to the original a behavior it does not have");
    expect(instruction).toContain("aggregate from the full set with an outer join rather than from the detail side alone");
    expect(instruction).toContain(DEFINITION_USE);
    expect(instruction).toContain("trace each example once for definition/use mismatches");
  });

  it("keeps the rules for a plain conversational question (they are not creation-gated)", () => {
    const intent = classifyOriginRequestIntent("日本の首都はどこですか？", "review");
    expect(intent.interactionMode).toBe("conversation");
    const instruction = originChatSystemInstruction(intent);
    expect(instruction).toContain(SUPPLEMENT);
    expect(instruction).toContain(EQUIVALENCE);
    expect(instruction).toContain(DEFINITION_USE);
  });

  it("carries the rules in the route-2 compact variant (registered in the compact base)", () => {
    const variant = originCloudflareRouteSystemInstruction(originChatSystemInstruction());
    expect(variant).toContain(SUPPLEMENT);
    expect(variant).toContain(EQUIVALENCE);
    expect(variant).toContain(DEFINITION_USE);
  });
});

describe("code-handling rules (CB-5)", () => {
  const AWAIT_NONBLOCKING = "await suspends only the async function and does not block the thread";
  const SCOPE = "Each example must define every name it uses";
  const GOVERN = "Let that traced behavior govern every description of the original in the answer";
  const API_CONVENTIONS = "keep the API conventions the given code shows";

  it("states the await non-blocking canon and the scope, governing, and API rules in the full base instruction", () => {
    const instruction = originChatSystemInstruction();
    expect(instruction).toContain(AWAIT_NONBLOCKING);
    expect(instruction).toContain("while one async function waits, the event loop keeps running other code");
    expect(instruction).toContain("Never describe waiting as blocking");
    expect(instruction).toContain(SCOPE);
    expect(instruction).toContain("a name defined inside one function is not available in another function or example");
    expect(instruction).toContain("so give each example its own inputs or pass them in as parameters");
    expect(instruction).toContain(GOVERN);
    expect(instruction).toContain("in prose, tables, and summaries alike");
    expect(instruction).toContain("check each such claim against the trace and against the replacement code");
    expect(instruction).toContain(API_CONVENTIONS);
    expect(instruction).toContain("do not switch dialects or libraries");
    expect(instruction).toContain("a hedge in the prose does not excuse a different choice in the code");
  });

  it("keeps the rules for a plain conversational question (they are not creation-gated)", () => {
    const intent = classifyOriginRequestIntent("日本の首都はどこですか？", "review");
    expect(intent.interactionMode).toBe("conversation");
    const instruction = originChatSystemInstruction(intent);
    expect(instruction).toContain(AWAIT_NONBLOCKING);
    expect(instruction).toContain(SCOPE);
    expect(instruction).toContain(GOVERN);
    expect(instruction).toContain(API_CONVENTIONS);
  });

  it("carries the rules in the route-2 compact variant (registered in the compact base)", () => {
    const variant = originCloudflareRouteSystemInstruction(originChatSystemInstruction());
    expect(variant).toContain(AWAIT_NONBLOCKING);
    expect(variant).toContain(SCOPE);
    expect(variant).toContain(GOVERN);
    expect(variant).toContain(API_CONVENTIONS);
  });

  it("carries the condensed rules on the route-3 compact instruction within its budget", () => {
    const compact = originGroqRouteSystemInstruction();
    expect(compact).toContain(AWAIT_NONBLOCKING);
    expect(compact).toContain("other code keeps running while it waits");
    expect(compact).toContain("never present waiting as blocking");
    expect(compact).toContain("each example must define every name it uses");
    expect(compact).toContain("a name defined inside one function is not available in another");
    expect(compact).toContain("govern every description of the original");
    expect(compact).toContain("check each claim against the trace and the code");
    expect(compact).toContain(API_CONVENTIONS);
    expect(compact).toContain("do not switch dialects");
    expect(compact.length).toBeLessThanOrEqual(6_000);
  });
});

describe("code-review finding discipline (CB-6)", () => {
  // CODEBENCH_CB6_DESIGN_2026-11-25: the E-03 failure was a finding-
  // selection failure, not a tracing failure - the answer justified
  // its headline defect with a generic weakness that does not apply
  // to the code's use, padded the review with generic checklist
  // items the supplied code does not exhibit, and presented a
  // replacement carrying unused imports. CB-3 through CB-5 governed
  // tracing and equivalence only; these pins lock the discipline
  // that governs which problems a review may report, the operative
  // reason it must give, and the nothing-unused self-check, on every
  // instruction variant a code task can be served with.
  const FINDING_DISCIPLINE = "lead with the most consequential problem in that code";
  const TRACEABLE = "every point must be traceable to a specific line or behavior of that code";
  const NO_OMISSION = "no problem actually present may be omitted to keep the list short";
  const NO_PADDING = "Do not pad the review with generic checklist items";
  const ALREADY_CORRECT = "where part of the supplied code is already correct, say so in one line";
  const OPERATIVE_REASON = "state the operative reason it is a problem for this code's purpose";
  const NOTHING_UNUSED = "Leave nothing unused";
  const REMOVE_CARRIED_IMPORTS = "remove imports or names carried over from the original";

  it("states the finding discipline and the nothing-unused rule in the full base instruction", () => {
    const instruction = originChatSystemInstruction();
    expect(instruction).toContain(FINDING_DISCIPLINE);
    expect(instruction).toContain(TRACEABLE);
    expect(instruction).toContain(NO_OMISSION);
    expect(instruction).toContain(NO_PADDING);
    expect(instruction).toContain(ALREADY_CORRECT);
    expect(instruction).toContain(OPERATIVE_REASON);
    expect(instruction).toContain("not a generic weakness of the construct that does not apply to this use");
    expect(instruction).toContain(NOTHING_UNUSED);
    expect(instruction).toContain(REMOVE_CARRIED_IMPORTS);
    // The discipline bullet appears exactly once: it is a base rule,
    // not a per-section restatement.
    expect(instruction.split(FINDING_DISCIPLINE).length - 1).toBe(1);
  });

  it("keeps the rules for a plain conversational question (they are not creation-gated)", () => {
    const intent = classifyOriginRequestIntent("日本の首都はどこですか？", "review");
    expect(intent.interactionMode).toBe("conversation");
    const instruction = originChatSystemInstruction(intent);
    expect(instruction).toContain(FINDING_DISCIPLINE);
    expect(instruction).toContain(NO_PADDING);
    expect(instruction).toContain(OPERATIVE_REASON);
    expect(instruction).toContain(NOTHING_UNUSED);
  });

  it("carries the rules in the route-2 compact variant (registered in the compact base)", () => {
    const variant = originCloudflareRouteSystemInstruction(originChatSystemInstruction());
    expect(variant).toContain(FINDING_DISCIPLINE);
    expect(variant).toContain(TRACEABLE);
    expect(variant).toContain(NO_OMISSION);
    expect(variant).toContain(NO_PADDING);
    expect(variant).toContain(OPERATIVE_REASON);
    expect(variant).toContain(NOTHING_UNUSED);
    expect(variant).toContain(REMOVE_CARRIED_IMPORTS);
  });

  it("carries the condensed rules on the route-3 compact instruction within its budget", () => {
    const compact = originGroqRouteSystemInstruction();
    expect(compact).toContain("lead with the supplied code's most consequential problem");
    expect(compact).toContain("report every problem actually present in it");
    expect(compact).toContain("never pad with generic checklist items");
    expect(compact).toContain("say in one line when a part is already correct");
    expect(compact).toContain("State the operative reason each problem fails here");
    expect(compact).toContain("not a generic weakness of the construct");
    expect(compact).toContain(NOTHING_UNUSED);
    expect(compact).toContain("remove imports the replacement no longer uses");
    expect(compact.length).toBeLessThanOrEqual(6_000);
  });
});
