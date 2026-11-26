import { describe, expect, it } from "vitest";
import { classifyOriginSearchQuestion } from "./originSearchClassifier.js";

/**
 * The §6 verification set of ANSWER_FOLLOWUP_DIAGNOSIS_2026-11-26,
 * pinned at the layer each item is decided at. The production run
 * (the coordinator's, after deploy) re-asks the same questions
 * end-to-end; these pins keep the routes that made the round-8
 * failures possible from silently returning:
 *  - the weekday questions must classify as the deterministic
 *    date route, never as a freshness demand (the wipe refused
 *    them twice in production);
 *  - date-CONTAINING questions that genuinely need search or the
 *    weather route must keep those routes (both-direction rule);
 *  - the over-refusal representatives must classify onto routes
 *    that can answer them — a generation task to generation, a
 *    standing institutional fact to the policy route, a settled
 *    market fact to the market route, arithmetic to the
 *    deterministic calculation.
 */
describe("§6 date questions — the deterministic route, both directions", () => {
  it("weekday / date questions classify deterministic-date", () => {
    for (const question of [
      "今日は何曜日ですか？",
      "明日は何曜日ですか？",
      "今日は何月何日ですか？",
      "2026年12月25日は何曜日ですか？",
    ]) {
      const classification = classifyOriginSearchQuestion(question);
      expect(classification.type, question).toBe("no_search");
      expect(classification.rule, question).toBe("deterministic-date");
    }
  });

  it("今日のニュース keeps the news route and 今日の天気 the weather route", () => {
    expect(classifyOriginSearchQuestion("今日のニュースを教えてください。").type).toBe("news");
    expect(classifyOriginSearchQuestion("今日の東京の天気は？").type).toBe("weather");
  });
});

describe("§6 over-refusal representatives — routes that can answer", () => {
  it("A-09 報連相 explanation is a generation task, not a research demand", () => {
    const classification = classifyOriginSearchQuestion(
      "新入社員に「報連相」を説明する短い文章を作ってください。",
    );
    expect(classification.type).toBe("no_search");
  });

  it("B-02 国民年金 age is a policy question (standing institutional fact)", () => {
    const classification = classifyOriginSearchQuestion(
      "国民年金は原則として何歳から受け取れますか？",
    );
    expect(classification.type).toBe("policy");
  });

  it("C-01 パスポート age is not forced into a freshness route", () => {
    const classification = classifyOriginSearchQuestion(
      "パスポートの10年用が取れる年齢と必要なものを教えてください。",
    );
    expect(classification.type).toBe("no_search");
  });

  it("D-15 議員定数 is not forced into a freshness route", () => {
    const classification = classifyOriginSearchQuestion(
      "国会の衆議院と参議院の議員定数はそれぞれ何人ですか？",
    );
    expect(classification.type).toBe("no_search");
  });

  it("G-05 日経平均史上最高値 takes the market route (settled history, not a freshness wipe)", () => {
    const classification = classifyOriginSearchQuestion(
      "日経平均株価が過去最高値を付けたのはいつで、いくらでしたか？",
    );
    expect(classification.type).toBe("market");
  });

  it("H-09 40人×75% is a deterministic calculation", () => {
    const classification = classifyOriginSearchQuestion(
      "定員40人のクラスで75%が出席しました。出席したのは何人ですか？",
    );
    expect(classification.type).toBe("no_search");
    expect(classification.rule).toBe("deterministic-calculation");
  });
});
