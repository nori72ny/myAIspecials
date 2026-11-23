import { describe, expect, it } from "vitest";
import {
  buildGroundedResearchAbstainAnswer,
  type OriginResearchAbstainReason,
} from "./groundedResearchOutcome";

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
  it("echoes a short Japanese question in the searched lead", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "最新の物価を教えてください", language: "ja", reason: "no-sources" });
    expect(text).toContain("「最新の物価を教えてください」について公開情報を調べましたが");
  });

  it("echoes a short Japanese question in the gate (unsearched) lead", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "空家等対策の推進に関する特別措置法は、いつ全面施行されましたか?", language: "ja", reason: "high-risk-insufficient-sources", searched: false });
    expect(text).toContain("「空家等対策の推進に関する特別措置法は、いつ全面施行されましたか?」について、出典による裏付けが取れなかったため");
  });

  it("echoes a short English question", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "latest consumer prices", language: "en", reason: "provider-error" });
    expect(text).toContain('I searched public sources for "latest consumer prices"');
  });

  it("echoes a query of exactly 40 characters and not one of 41", () => {
    const forty = "あ".repeat(40);
    const fortyOne = "あ".repeat(41);
    expect(buildGroundedResearchAbstainAnswer({ query: forty, language: "ja", reason: "no-sources" }))
      .toContain(`「${forty}」について公開情報を調べましたが`);
    expect(buildGroundedResearchAbstainAnswer({ query: fortyOne, language: "ja", reason: "no-sources" }))
      .toBe(buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason: "no-sources" }));
  });
});
