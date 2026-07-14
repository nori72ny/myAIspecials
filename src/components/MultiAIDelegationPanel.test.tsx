import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MultiAIDelegationPanel from "./MultiAIDelegationPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openPlanner() {
  fireEvent.click(screen.getByTestId("multi-ai-planner-open"));
  return screen.getByRole("dialog", { name: "AI作業振り分け" });
}

describe("MultiAIDelegationPanel", () => {
  it("opens and routes implementation work to AI Studio Primary", () => {
    render(<MultiAIDelegationPanel />);
    const dialog = openPlanner();

    fireEvent.change(within(dialog).getByPlaceholderText("例: 認証処理のセキュリティレビューをしてください"), {
      target: { value: "新しい画面を実装してください" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "担当AIと検証方法を判定" }));

    expect(within(dialog).getByText("AI Studio Primary")).toBeTruthy();
    expect(within(dialog).getByText("implementation")).toBeTruthy();
  });

  it("shows a human approval warning for production deployment", () => {
    render(<MultiAIDelegationPanel />);
    const dialog = openPlanner();

    fireEvent.change(within(dialog).getByPlaceholderText("例: 認証処理のセキュリティレビューをしてください"), {
      target: { value: "本番へデプロイしてください" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "担当AIと検証方法を判定" }));

    expect(within(dialog).getByText("Human Approval Gate")).toBeTruthy();
    expect(within(dialog).getByText("人の明示承認が必要です")).toBeTruthy();
  });

  it("copies a secret-safe delegation instruction", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<MultiAIDelegationPanel />);
    const dialog = openPlanner();

    fireEvent.change(within(dialog).getByPlaceholderText("例: 認証処理のセキュリティレビューをしてください"), {
      target: { value: "APIキー secret-value を確認してください" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "担当AIと検証方法を判定" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "指示をコピー" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copied).toContain("機密情報を除去した要約を人間が入力してください");
    expect(copied).not.toContain("secret-value");
  });
});
