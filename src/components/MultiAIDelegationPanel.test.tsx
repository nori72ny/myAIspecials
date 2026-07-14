import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MultiAIDelegationPanel from "./MultiAIDelegationPanel";

describe("MultiAIDelegationPanel", () => {
  it("opens and routes implementation work to AI Studio Primary", () => {
    render(<MultiAIDelegationPanel />);

    fireEvent.click(screen.getByTestId("multi-ai-planner-open"));
    fireEvent.change(screen.getByPlaceholderText("例: 認証処理のセキュリティレビューをしてください"), {
      target: { value: "新しい画面を実装してください" },
    });
    fireEvent.click(screen.getByRole("button", { name: "担当AIと検証方法を判定" }));

    expect(screen.getByText("AI Studio Primary")).toBeInTheDocument();
    expect(screen.getByText("implementation")).toBeInTheDocument();
  });

  it("shows a human approval warning for production deployment", () => {
    render(<MultiAIDelegationPanel />);

    fireEvent.click(screen.getByTestId("multi-ai-planner-open"));
    fireEvent.change(screen.getByPlaceholderText("例: 認証処理のセキュリティレビューをしてください"), {
      target: { value: "本番へデプロイしてください" },
    });
    fireEvent.click(screen.getByRole("button", { name: "担当AIと検証方法を判定" }));

    expect(screen.getByText("人の明示承認が必要です")).toBeInTheDocument();
  });

  it("copies a secret-safe delegation instruction", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MultiAIDelegationPanel />);

    fireEvent.click(screen.getByTestId("multi-ai-planner-open"));
    fireEvent.change(screen.getByPlaceholderText("例: 認証処理のセキュリティレビューをしてください"), {
      target: { value: "APIキー secret-value を確認してください" },
    });
    fireEvent.click(screen.getByRole("button", { name: "担当AIと検証方法を判定" }));
    fireEvent.click(screen.getByRole("button", { name: "指示をコピー" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("機密情報を除去した要約を人間が入力してください");
    expect(copied).not.toContain("secret-value");
  });
});
