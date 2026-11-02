// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import ObservabilityCenter from "./ObservabilityCenter";

describe("ObservabilityCenter Component", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders correctly with tabs and default e2e section", () => {
    render(<ObservabilityCenter />);

    expect(screen.getByText((content) => content.includes("ACOS Observability & Validation Suite"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("End-to-End Tests"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Performance & LCP"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Error Recovery"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Security & Sanitization"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Readiness Report"))).toBeTruthy();

    fireEvent.click(screen.getByText((content) => content.includes("End-to-End Tests")));
    expect(screen.getByText((content) => content.includes("Automated E2E Simulation Center"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Execute Validation Suite"))).toBeTruthy();
  });

  it("completes simulated E2E suites without leaking async state updates", async () => {
    vi.useFakeTimers();
    render(<ObservabilityCenter />);

    fireEvent.click(screen.getByText((content) => content.includes("End-to-End Tests")));
    fireEvent.click(screen.getByText((content) => content.includes("Execute Validation Suite")));

    expect(screen.getByText((content) => content.includes("Running Validation..."))).toBeTruthy();

    // The component runs nine sequential delays (200–784ms); settle all of them
    // before cleanup so React state updates cannot escape the jsdom lifecycle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(screen.getByText((content) => content.includes("Q5 Validation Passed successfully."))).toBeTruthy();
  });

  it("switches to Performance tab and displays live stats", async () => {
    render(<ObservabilityCenter />);

    fireEvent.click(screen.getByText((content) => content.includes("Performance & LCP")));
    expect(await screen.findByText((content) => content.includes("Interactive Latency"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Estimated LCP"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("JS Heap Memory"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Live Telemetry Observer"))).toBeTruthy();
  });

  it("switches to Error Recovery tab and settles the timeout simulation", async () => {
    vi.useFakeTimers();
    render(<ObservabilityCenter />);

    fireEvent.click(screen.getByText((content) => content.includes("Error Recovery")));
    expect(screen.getByText((content) => content.includes("Error Injection & Graceful Recovery Simulations"))).toBeTruthy();

    fireEvent.click(screen.getByText((content) => content.includes("AI Timeout Failure")));
    expect(screen.getByText((content) => content.includes("Recovery Lifecycle Logger"))).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  });

  it("switches to Readiness Report tab and renders ratings", async () => {
    render(<ObservabilityCenter />);

    fireEvent.click(screen.getByText((content) => content.includes("Readiness Report")));
    expect(await screen.findByText((content) => content.includes("Production Readiness Report"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("OVERALL ARCH SCORE"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("UI Quality"))).toBeTruthy();
  });
});
