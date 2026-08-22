// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import MissionInput from "./MissionInput";

describe("MissionInput Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders correctly with default placeholder text", () => {
    render(<MissionInput />);
    
    // Check that the input is rendered with default placeholder
    const input = screen.getByPlaceholderText(/What is your next mission\?/i) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("updates text value when user types into the input", () => {
    render(<MissionInput />);
    const input = screen.getByPlaceholderText(/What is your next mission\?/i) as HTMLInputElement;
    
    fireEvent.change(input, { target: { value: "Verify Next-Gen AI Agent" } });
    expect(input.value).toBe("Verify Next-Gen AI Agent");
  });

  it("populates prompt when clicking a quick action item (after focus)", () => {
    render(<MissionInput />);
    const input = screen.getByPlaceholderText(/What is your next mission\?/i) as HTMLInputElement;
    
    // Focus the input to reveal the dropdown
    fireEvent.focus(input);

    // Click suggestion
    const actionBtn = screen.getByText(/Execute Market Research/i);
    // Note: The component uses onMouseDown instead of onClick for action clicks to prevent onBlur hiding it
    fireEvent.mouseDown(actionBtn);
    
    expect(input.value).toBe("Execute Market Research");
  });

  it("triggers onSubmit handler with the prompt value on submit", () => {
    const handleSubmit = vi.fn();
    render(<MissionInput onSubmit={handleSubmit} />);
    
    const input = screen.getByPlaceholderText(/What is your next mission\?/i);
    
    // Enter prompt
    fireEvent.change(input, { target: { value: "Run Market Research" } });
    
    // Submit via form submit
    fireEvent.submit(input);
    
    // The submit callback should be triggered with correct payload
    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledWith("Run Market Research");
  });

  it("enables voice recording simulation UI on voice button click", () => {
    render(<MissionInput />);

    const voiceBtn = screen.getByRole("button", { name: "Start voice input" });
    expect(voiceBtn.className).toContain("min-h-11");
    expect(voiceBtn.className).toContain("min-w-11");
    expect(voiceBtn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(voiceBtn);

    expect(screen.getByRole("button", { name: "Stop voice input" })).toBe(voiceBtn);
    expect(voiceBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps both voice and send controls at least 44px in each dimension", () => {
    render(<MissionInput />);

    for (const name of ["Start voice input", "Send mission"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
    }
  });
});
