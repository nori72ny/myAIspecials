import { describe, it, expect, vi, beforeEach } from "vitest";
import { isSafeIp, isWhitelistedDomain, secureFetch, validateSafePath } from "../application/agent/ToolExecutor";
import { AgentRuntime } from "../application/agent/AgentRuntime";
import { Mission, Task, Agent } from "@origin/domain";
import { ILLMClient } from "../infrastructure/ai/ILLMClient";
import { MemoryManager } from "../application/agent/ExecutionMemory";

describe("=== Version 1.1 Safety and Hardening Policies ===", () => {
  describe("1. SSRF and DNS Rebinding Prevention (isSafeIp)", () => {
    it("accepts safe public IPv4 addresses", () => { expect(isSafeIp("8.8.8.8")).toBe(true); expect(isSafeIp("1.1.1.1")).toBe(true); expect(isSafeIp("142.250.190.46")).toBe(true); });
    it("rejects localhost / loopback IPs", () => { expect(isSafeIp("127.0.0.1")).toBe(false); expect(isSafeIp("127.255.255.255")).toBe(false); expect(isSafeIp("::1")).toBe(false); expect(isSafeIp("0:0:0:0:0:0:0:1")).toBe(false); });
    it("rejects RFC1918 private ranges", () => { expect(isSafeIp("10.0.0.1")).toBe(false); expect(isSafeIp("10.255.255.255")).toBe(false); expect(isSafeIp("172.16.42.1")).toBe(false); expect(isSafeIp("172.31.255.255")).toBe(false); expect(isSafeIp("192.168.1.100")).toBe(false); });
    it("rejects metadata and link-local ranges", () => { expect(isSafeIp("169.254.169.254")).toBe(false); expect(isSafeIp("169.254.0.1")).toBe(false); expect(isSafeIp("fe80::1")).toBe(false); });
    it("rejects reserved and multicast ranges", () => { expect(isSafeIp("0.0.0.0")).toBe(false); expect(isSafeIp("224.0.0.1")).toBe(false); expect(isSafeIp("255.255.255.255")).toBe(false); });
    it("rejects private IPv6 unique local ranges", () => { expect(isSafeIp("fc00::1")).toBe(false); expect(isSafeIp("fdff:ffff::ffff")).toBe(false); });
  });

  describe("2. URL Scheme & Domain Whitelisting", () => {
    it("matches whitelisted domains and subdomains", () => { expect(isWhitelistedDomain("wikipedia.org")).toBe(true); expect(isWhitelistedDomain("en.wikipedia.org")).toBe(true); expect(isWhitelistedDomain("api.github.com")).toBe(true); expect(isWhitelistedDomain("raw.githubusercontent.com")).toBe(true); expect(isWhitelistedDomain("httpbin.org")).toBe(true); });
    it("rejects non-whitelisted domains", () => { expect(isWhitelistedDomain("malicious-domain.com")).toBe(false); expect(isWhitelistedDomain("attacker.org")).toBe(false); expect(isWhitelistedDomain("google.com")).toBe(false); });
    it("fails secureFetch for bad scheme or non-whitelisted domain", async () => { await expect(secureFetch("ftp://wikipedia.org")).rejects.toThrow("Only HTTP and HTTPS"); await expect(secureFetch("http://localhost/api")).rejects.toThrow("Localhost domain is prohibited"); await expect(secureFetch("https://attacker.com/payload")).rejects.toThrow("not whitelisted"); });
  });

  describe("3. Path Traversal & Sandbox Escape (validateSafePath)", () => {
    it("accepts valid relative paths inside the sandbox", async () => { expect(await validateSafePath("src/application/agent/ToolExecutor.ts")).toContain("src/application/agent/ToolExecutor.ts"); });
    it("rejects traversal paths with the fail-closed boundary code", async () => { await expect(validateSafePath("../../etc/passwd")).rejects.toThrow("PATH_OUTSIDE_WORKSPACE"); await expect(validateSafePath("src/application/../../../etc/passwd")).rejects.toThrow("PATH_OUTSIDE_WORKSPACE"); });
    it("rejects URL-encoded traversal attempts", async () => { await expect(validateSafePath("%2e%2e%2f%2e%2e%2fetc/passwd")).rejects.toThrow("PATH_OUTSIDE_WORKSPACE"); });
    it("rejects absolute paths before normalization", async () => { await expect(validateSafePath("/etc/passwd")).rejects.toThrow("PATH_OUTSIDE_WORKSPACE"); });
    it("rejects Windows-style path bypasses", async () => { await expect(validateSafePath("..\\..\\etc\\passwd")).rejects.toThrow("PATH_OUTSIDE_WORKSPACE"); await expect(validateSafePath("src\\..\\..\\etc\\passwd")).rejects.toThrow("PATH_OUTSIDE_WORKSPACE"); });
  });

  describe("4. Tool Budget, Circuit Breaker, & Duplicate Execution Controls", () => {
    let mockLlmClient: ILLMClient; let mockMission: Mission; let mockTask: Task; let mockAgent: Agent;
    beforeEach(() => { MemoryManager.getInstance().clearAll(); mockLlmClient = { generateText: vi.fn() } as any; mockMission = { id: "MS-SAFE-TURN", objective: "Verify defensive runtime loops", tasks: [], agents: [], successCriteria: ["Execution finishes peacefully"] } as any; mockTask = { id: "TSK-001", description: "Perform tool actions", agentId: "AG-001", dependencies: [] } as any; mockAgent = { id: "AG-001", role: "Developer", backstory: "A careful node engineer", skills: [], capabilities: [] } as any; });
    it("aborts tool loops when consecutive failures breach the limit", async () => { const runtime = new AgentRuntime(mockLlmClient, { maxAttempts: 3 }); let count = 0; vi.spyOn(mockLlmClient, "generateText").mockImplementation(async () => { count++; return `Step plain text count ${count}.\nTOOL_CALL: {"tool": "FileTool", "input": {"action": "read", "path": "non_existent_file_${count}.txt"}}`; }); const res = await runtime.execute(mockMission, mockTask, mockAgent, "JSON"); const steps = MemoryManager.getInstance().getAgentScratchpad(mockMission.id, mockTask.id).getSteps().join("\n"); expect(steps).toContain("Circuit breaker tripped"); expect(res.success).toBe(false); });
    it("aborts tool loops when the total tool call budget is exhausted", async () => { const runtime = new AgentRuntime(mockLlmClient, { maxAttempts: 3 }); let count = 0; vi.spyOn(mockLlmClient, "generateText").mockImplementation(async () => { count++; return `Calculate plain text count ${count}.\nTOOL_CALL: {"tool": "CalculatorTool", "input": {"expression": "1+${count}"}}`; }); const res = await runtime.execute(mockMission, mockTask, mockAgent, "JSON"); const steps = MemoryManager.getInstance().getAgentScratchpad(mockMission.id, mockTask.id).getSteps().join("\n"); expect(steps).toContain("budget of 6 exhausted"); expect(res.success).toBe(false); });
    it("aborts repeated identical tool execution", async () => { const runtime = new AgentRuntime(mockLlmClient, { maxAttempts: 3 }); vi.spyOn(mockLlmClient, "generateText").mockResolvedValue(`Let's run exactly same call.\nTOOL_CALL: {"tool": "CalculatorTool", "input": {"expression": "100+100"}}`); const res = await runtime.execute(mockMission, mockTask, mockAgent, "JSON"); const steps = MemoryManager.getInstance().getAgentScratchpad(mockMission.id, mockTask.id).getSteps().join("\n"); expect(steps).toContain("Duplicate Tool Detection"); expect(res.success).toBe(false); });
  });
});
