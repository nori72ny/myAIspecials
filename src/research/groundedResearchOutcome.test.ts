import { describe, expect, it } from "vitest";
import {
  buildGroundedResearchAbstainAnswer,
  type OriginResearchAbstainReason,
} from "./groundedResearchOutcome";
import { withAlterEgoMode } from "../lib/orchestration/alterEgoRequestStore";

// P1 countermeasure 1 (WEEKLY_INSPECTION_P1_DIAGNOSIS_2026-11-23): the
// tier-T4 hold text must never echo a long query. The echo exists so a
// person recognizes their own short question; text that was never
// written to be displayed — above all the internal refinement
// instructions the client sends as a message — must not reappear in
// the answer body on ANY landing. This builder is the single
// generator behind every landing (grounded path, terminal guard, and
// the publication gate's hold), so these cases pin all of them.

const REASONS: OriginResearchAbstainReason[] = [
  "no-sources",
  "no-fresh-sources",
  "provider-error",
  "monthly-cap-reached",
  "budget-exhausted",
  "high-risk-insufficient-sources",
];

// The four refinement prompts exactly as built by
// src/components/personal/OriginAnswerMarkdown.tsx refinementPrompt(),
// plus the English depth prompt (the one whose wording also matches
// the research-request patterns in English).
const REFINEMENT_PROMPTS: Array<{ kind: string; language: "ja" | "en"; prompt: string }> = [
  { kind: "depth", language: "ja", prompt: "直前の回答を、実務でそのまま判断・実行に使える深さまで引き上げてください。結論は明確に保ちつつ、不足している判断基準、根拠、適用条件、比較、トレードオフ、リスク、具体手順、検証方法、未確認点を補ってください。依頼の種類に合わせ、調査なら出典・条件・比較理由、開発なら使える変更内容・組込み方・テスト・制約、計画なら成果物・依存関係・担当・完了条件を含めてください。文字数を増やすための一般論や、未確認の事実の創作はしないでください。" },
  { kind: "example", language: "ja", prompt: "直前の回答に、私の依頼に直接使える具体例を追加し、その例が結論や提案にどうつながるかまで示してください。仮定や例示は明示し、重要な条件を落とさず、架空の事例を実績として扱わないでください。" },
  { kind: "plan", language: "ja", prompt: "直前の回答を、実際に進められる実行プランに変換してください。結論と制約を維持し、実施順、依存関係、判断ポイント、各重要工程の検証方法、明確な完了条件まで示してください。開発作業なら変更対象のファイルやコンポーネント、完了を証明するテストやチェックも具体化してください。未実施の作業を完了済みとは書かないでください。" },
  { kind: "summary", language: "ja", prompt: "直前の回答を、意思決定に必要な結論と次の行動がすぐ分かる形に圧縮してください。重要な条件、リスク、不確実性は残し、必要情報ではなく重複を削ってください。" },
  { kind: "depth", language: "en", prompt: "Upgrade your previous answer to professional working depth. Keep the direct conclusion, then fill the material gaps with decision criteria, evidence or reasoning, relevant conditions, trade-offs, risks, concrete steps, verification, and explicit unknowns. Adapt the structure to the task: research needs sources/conditions/comparison logic; coding needs usable changes, integration, tests, and limitations; planning needs deliverables, dependencies, ownership, and completion criteria. Do not add filler or invent facts." },
];

describe("buildGroundedResearchAbstainAnswer: long queries are never echoed (P1)", () => {
  for (const { kind, language, prompt } of REFINEMENT_PROMPTS) {
    it(`the ${language} ${kind} refinement prompt produces the generic hold for every reason and landing shape`, () => {
      for (const reason of REASONS) {
        for (const searched of [true, false]) {
          const text = buildGroundedResearchAbstainAnswer({ query: prompt, language, reason, searched });
          // Identical to the hold for an empty query: no topic at all.
          expect(text).toBe(buildGroundedResearchAbstainAnswer({ query: "", language, reason, searched }));
          // No substring of the instruction survives — neither its head
          // (the former 120-character leak) nor any later fragment.
          expect(text).not.toContain(prompt.slice(0, 40));
          expect(text).not.toContain(prompt.slice(40, 80));
          expect(text).not.toContain(prompt.slice(-40));
        }
      }
    });
  }

  it("a long pasted passage is not echoed either", () => {
    const pasted = "これは利用者が貼り付けた長い文章です。".repeat(6);
    const text = buildGroundedResearchAbstainAnswer({ query: pasted, language: "ja", reason: "no-sources" });
    expect(text).toBe(buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason: "no-sources" }));
    expect(text).not.toContain("貼り付けた長い文章");
  });
});

describe("buildGroundedResearchAbstainAnswer: short questions keep their echo", () => {
  it("echoes a short Japanese question in the lead", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "最新の物価を教えてください", language: "ja", reason: "no-sources" });
    expect(text).toContain("「最新の物価を教えてください」については、確認できた情報がないため、推測で回答しません。");
  });

  it("echoes a short Japanese question in the gate landing with the same lead", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "空家等対策の推進に関する特別措置法は、いつ全面施行されましたか?", language: "ja", reason: "high-risk-insufficient-sources", searched: false });
    expect(text).toContain("「空家等対策の推進に関する特別措置法は、いつ全面施行されましたか?」については、確認できた情報がないため、推測で回答しません。");
    // The gate performed no search, and neither the lead nor the
    // high-risk reason text claims one.
    expect(text).not.toContain("調べましたが");
    expect(text).not.toContain("探しましたが");
  });

  it("echoes a short English question", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "latest consumer prices", language: "en", reason: "provider-error" });
    expect(text).toContain('For "latest consumer prices", I have no confirmed information, so I will not guess an answer.');
  });

  it("echoes a query of exactly 40 characters and not one of 41", () => {
    const forty = "あ".repeat(40);
    const fortyOne = "あ".repeat(41);
    expect(buildGroundedResearchAbstainAnswer({ query: forty, language: "ja", reason: "no-sources" }))
      .toContain(`「${forty}」については、確認できた情報がないため`);
    expect(buildGroundedResearchAbstainAnswer({ query: fortyOne, language: "ja", reason: "no-sources" }))
      .toBe(buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason: "no-sources" }));
  });
});

describe("buildGroundedResearchAbstainAnswer: shortened three-part shape (4-C)", () => {
  it("states the point first, drops the repeated no-information tail, and names where to check", () => {
    for (const reason of REASONS) {
      const text = buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason });
      expect(text.startsWith("確認できた情報がないため、推測で回答しません。")).toBe(true);
      // The former tail repeated the lead in every reason text.
      expect(text).not.toContain("確認できた情報はありませんでした");
      // The closing names the definitive check destination.
      expect(text).toContain("正確な情報は、公式の発表などでご確認ください。");
    }
    const en = buildGroundedResearchAbstainAnswer({ query: "", language: "en", reason: "no-sources" });
    expect(en.startsWith("I have no confirmed information, so I will not guess an answer.")).toBe(true);
    expect(en).not.toContain("There is no information I could confirm");
    expect(en).toContain("please check the official announcement");
  });

  it("is shorter than the pre-shortening shape for the same landing", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "最新の物価を教えてください", language: "ja", reason: "no-fresh-sources" });
    // The pre-shortening text for this exact landing measured 184
    // characters; the shortened shape measures 157.
    expect(text.length).toBeLessThan(170);
  });
});

// Alter-ego mode (2026-11-28): the hold body is fixed text that never
// passes through the model, so the builder itself switches the
// Japanese hold to the plain register while the mode is on — same
// content, same honesty, no first person added. With the mode off the
// output must stay byte-identical to the standard hold (the describes
// above pin that text outside any alter-ego context), and the English
// hold never changes.
describe("buildGroundedResearchAbstainAnswer: alter-ego mode plain register (ja)", () => {
  const ALTER_EGO_JA_REASON_TEXT: Record<OriginResearchAbstainReason, string> = {
    "no-sources": "関連する公開情報源を探したけど、条件に合う出典が見つからなかった。",
    "no-fresh-sources":
      "情報源は見つかったけど、いずれも必要な新しさを満たしていなかったから、古い情報を現在の情報として示すことはしなかった。",
    "provider-error": "情報源を取る処理で問題が起きて、出典を確認できなかった。",
    "monthly-cap-reached": "今月の検索利用の上限に達しているから、今回は検索を実行できなかった。",
    "budget-exhausted": "制限時間内に裏付けの確認を終えることができなかった。",
    "high-risk-insufficient-sources":
      "重要な内容だから複数の独立した出典による裏付けが必要だけど、十分な出典が揃わなかった。",
  };

  it("switches lead, reason, and closing to the plain register for every reason", () => {
    withAlterEgoMode(true, () => {
      for (const reason of REASONS) {
        const text = buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason });
        expect(text).toBe(
          `確認できた情報がないから、推測では答えない。\n\n${ALTER_EGO_JA_REASON_TEXT[reason]}\n\n正確な情報は、公式の発表などで確認してほしい。確認したい公開情報源があれば出して。`,
        );
        // No polite-register residue and no persona additions.
        expect(text).not.toContain("回答しません");
        expect(text).not.toContain("ご確認ください");
        expect(text).not.toContain("提示してください");
        expect(text).not.toContain("僕");
      }
    });
  });

  it("matches the production provider-error landing, topic echo included", () => {
    const text = withAlterEgoMode(true, () =>
      buildGroundedResearchAbstainAnswer({ query: "今日はなんだか疲れたよ", language: "ja", reason: "provider-error" }));
    expect(text).toBe(
      "「今日はなんだか疲れたよ」については、確認できた情報がないから、推測では答えない。\n\n情報源を取る処理で問題が起きて、出典を確認できなかった。\n\n正確な情報は、公式の発表などで確認してほしい。確認したい公開情報源があれば出して。",
    );
  });

  it("keeps the long-query echo closed in alter-ego mode (P1)", () => {
    withAlterEgoMode(true, () => {
      for (const { prompt } of REFINEMENT_PROMPTS.filter((entry) => entry.language === "ja")) {
        const text = buildGroundedResearchAbstainAnswer({ query: prompt, language: "ja", reason: "provider-error" });
        expect(text.startsWith("確認できた情報がないから、推測では答えない。")).toBe(true);
        expect(text).not.toContain("直前の回答");
      }
    });
  });

  it("leaves the English hold byte-identical in alter-ego mode", () => {
    for (const reason of REASONS) {
      const on = withAlterEgoMode(true, () =>
        buildGroundedResearchAbstainAnswer({ query: "latest prices", language: "en", reason }));
      const off = withAlterEgoMode(false, () =>
        buildGroundedResearchAbstainAnswer({ query: "latest prices", language: "en", reason }));
      expect(on).toBe(off);
    }
  });

  it("is byte-identical to the standard hold when the mode is explicitly off", () => {
    for (const reason of REASONS) {
      const off = withAlterEgoMode(false, () =>
        buildGroundedResearchAbstainAnswer({ query: "最新の物価を教えてください", language: "ja", reason }));
      const unset = buildGroundedResearchAbstainAnswer({ query: "最新の物価を教えてください", language: "ja", reason });
      expect(off).toBe(unset);
      expect(off).toContain("推測で回答しません。");
      expect(off).toContain("正確な情報は、公式の発表などでご確認ください。確認したい公開情報源があれば提示してください。");
    }
  });
});
