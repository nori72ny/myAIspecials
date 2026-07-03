// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BrainOverview from "./BrainOverview";

describe("BrainOverview Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders correctly with main title and stats indicators", () => {
    render(<BrainOverview />);
    
    // Check main headers
    expect(screen.getByText((content) => content.includes("ACOS 2.0 Unified Cognitive Brain"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Multi-Agent Cognitive Engine & Neural Synaptic Grid"))).toBeTruthy();
    
    // Check key metrics are present
    expect(screen.getByText("Synaptic Throughput")).toBeTruthy();
    expect(screen.getByText("Cognitive Pulse Load")).toBeTruthy();
    expect(screen.getByText("Consensus Rate")).toBeTruthy();
    expect(screen.getByText("Total Thoughts Run")).toBeTruthy();
  });

  it("renders the 10-layer cognitive map and allows selecting layers", () => {
    render(<BrainOverview />);
    
    // Verify Master Brain layer exists and is default active
    const masterBrainElements = screen.getAllByText("Master Brain");
    expect(masterBrainElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("司令部・マスターブレイン")).toBeTruthy();
    
    // Verify details for Master Brain layer are visible initially
    expect(screen.getByText((content) => content.includes("Orchestrates, routes, and monitors all nine layers."))).toBeTruthy();

    // Find and click the memory brain layer
    const memoryBrainElements = screen.getAllByText("Memory Brain");
    const memoryBrainBtn = memoryBrainElements[0];
    expect(memoryBrainBtn).toBeTruthy();
    
    fireEvent.click(memoryBrainBtn);

    // After clicking Memory Brain, details should show its content
    expect(screen.getByText((content) => content.includes("Compiles user preferences, workspace context"))).toBeTruthy();
    expect(screen.getByText("DNA Context Recall")).toBeTruthy();
  });

  it("allows switching debate topics and updates messages", () => {
    render(<BrainOverview />);
    
    // Switch debate topic using selector dropdown
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("saas-architecture");

    // Change value to customer-conversion
    fireEvent.change(select, { target: { value: "customer-conversion" } });
    expect(select.value).toBe("customer-conversion");

    // Check message update matching conversion topic
    expect(screen.getByText((content) => content.includes("SSO-only gating for high-tier professional domains"))).toBeTruthy();
  });
});
