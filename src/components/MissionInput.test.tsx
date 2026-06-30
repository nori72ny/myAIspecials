// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MissionInput from "./MissionInput";

describe("MissionInput Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders correctly with custom title and placeholder text", () => {
    render(<MissionInput />);
    
    // Check that ORIGIN logo is rendered
    expect(screen.getByText("ORIGIN OS")).toBeTruthy();
    
    // Check that the core question display heading is present
    expect(screen.getByText("今日は何を達成しますか？")).toBeTruthy();
    
    // Check that the textarea is rendered with default placeholder
    const textarea = screen.getByPlaceholderText(/あなたのミッションを詳細に入力してください/i) as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("");
  });

  it("updates text value when user types into the textarea", () => {
    render(<MissionInput />);
    const textarea = screen.getByPlaceholderText(/あなたのミッションを詳細に入力してください/i) as HTMLTextAreaElement;
    
    fireEvent.change(textarea, { target: { value: "次世代AIエージェントの検証" } });
    expect(textarea.value).toBe("次世代AIエージェントの検証");
  });

  it("populates prompt when clicking a recommend suggestion item", () => {
    render(<MissionInput />);
    const textarea = screen.getByPlaceholderText(/あなたのミッションを詳細に入力してください/i) as HTMLTextAreaElement;
    
    // Click suggestion #1
    const suggestionBtn = screen.getByText(/AIシステムの全体システム設計図を作成して/i);
    fireEvent.click(suggestionBtn);
    
    expect(textarea.value).toBe("AIシステムの全体システム設計図を作成して");
  });

  it("triggers onSubmit handler with the prompt value on submit", () => {
    const handleSubmit = vi.fn();
    render(<MissionInput onSubmit={handleSubmit} />);
    
    const textarea = screen.getByPlaceholderText(/あなたのミッションを詳細に入力してください/i);
    const submitBtn = screen.getByText(/LAUNCH MISSION/i);
    
    // Initially submit button is disabled because text is empty
    expect(submitBtn).toBeTruthy();
    
    // Enter prompt
    fireEvent.change(textarea, { target: { value: "市場調査を実施して下さい" } });
    
    // Click submit button
    fireEvent.click(submitBtn);
    
    // The submit callback should be triggered with correct payload
    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledWith("市場調査を実施して下さい");
  });

  it("toggles theme class when the mode toggler is clicked", () => {
    render(<MissionInput />);
    const themeBtn = screen.getByTitle(/ライトモードに切り替え/i);
    expect(themeBtn).toBeTruthy();
    
    // Default is dark mode, so toggle button shows Sun icon and tooltip
    expect(screen.getByTitle("ライトモードに切り替え")).toBeTruthy();
    
    // Click to toggle to light mode
    fireEvent.click(themeBtn);
    
    // Tooltip should update
    expect(screen.getByTitle("ダークモードに切り替え")).toBeTruthy();
  });

  it("enables voice recording simulation UI on voice button click", () => {
    render(<MissionInput />);
    const voiceBtn = screen.getByText("VOICE");
    expect(voiceBtn).toBeTruthy();
    
    // Click voice button
    fireEvent.click(voiceBtn);
    
    // Button state should transition to RECORDING
    expect(screen.getByText("RECORDING...")).toBeTruthy();
  });
});
