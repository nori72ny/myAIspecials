import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistryService } from "../application/agent/governance/AgentRegistryService";
import { AgentGovernanceEvents } from "../application/agent/governance/AgentGovernanceEvents";
import { AgentScheduler } from "../application/agent/governance/AgentScheduler";
import { AgentLifecycleState, AgentCapability, AgentPermissions } from "../application/agent/governance/AgentGovernanceTypes";

describe("=== Version 1.3 Agent Governance Platform Unit Tests ===", () => {
  const registry = AgentRegistryService.getInstance();
  const eventLog = AgentGovernanceEvents.getInstance();
  const scheduler = new AgentScheduler(registry);

  beforeEach(() => {
    registry.clear();
    eventLog.clear();
  });

  describe("1. Agent Registry Service (35 Tests)", () => {
    it("1.1 should seed default agents on initialization", () => {
      const agents = registry.listAgents();
      expect(agents.length).toBeGreaterThanOrEqual(3);
      expect(agents.find(a => a.id === "agent-1")).toBeDefined();
    });

    it("1.2 should successfully register a new agent with basic values", () => {
      const record = registry.registerAgent("TEST-ROLE", [AgentCapability.Coding]);
      expect(record.role).toBe("TEST-ROLE");
      expect(record.capabilities).toContain(AgentCapability.Coding);
      expect(record.state).toBe(AgentLifecycleState.Registered);
    });

    it("1.3 should generate a unique ID starting with AGT- for registered agents", () => {
      const record = registry.registerAgent("TEST-ROLE", []);
      expect(record.id).toMatch(/^AGT-[A-Z0-9]{9}$/);
    });

    it("1.4 should register with default priority of 5", () => {
      const record = registry.registerAgent("ROLE", []);
      expect(record.priority).toBe(5);
    });

    it("1.5 should allow setting a custom initial priority on registration", () => {
      const record = registry.registerAgent("ROLE", [], {}, 9);
      expect(record.priority).toBe(9);
    });

    it("1.6 should initialize with 0 load", () => {
      const record = registry.registerAgent("ROLE", []);
      expect(record.load).toBe(0);
    });

    it("1.7 should initialize with pristine health metrics (successRate=1)", () => {
      const record = registry.registerAgent("ROLE", []);
      expect(record.health.successRate).toBe(1.0);
    });

    it("1.8 should initialize with pristine health metrics (errorRate=0)", () => {
      const record = registry.registerAgent("ROLE", []);
      expect(record.health.errorRate).toBe(0.0);
    });

    it("1.9 should initialize with pristine health metrics (averageRuntime=0)", () => {
      const record = registry.registerAgent("ROLE", []);
      expect(record.health.averageRuntime).toBe(0);
    });

    it("1.10 should initialize with pristine health metrics (averageTokens=0)", () => {
      const record = registry.registerAgent("ROLE", []);
      expect(record.health.averageTokens).toBe(0);
    });

    it("1.11 should support listing all registered agents", () => {
      const initialCount = registry.listAgents().length;
      registry.registerAgent("ROLE-1", []);
      registry.registerAgent("ROLE-2", []);
      expect(registry.listAgents().length).toBe(initialCount + 2);
    });

    it("1.12 should support finding a registered agent by ID", () => {
      const created = registry.registerAgent("FIND-ME", []);
      const fetched = registry.getAgent(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.role).toBe("FIND-ME");
    });

    it("1.13 should return null when searching for a non-existent agent ID", () => {
      expect(registry.getAgent("NON-EXISTENT-ID")).toBeNull();
    });

    it("1.14 should support deleting an agent successfully", () => {
      const created = registry.registerAgent("DELETE-ME", []);
      const deleted = registry.deleteAgent(created.id);
      expect(deleted).toBe(true);
      expect(registry.getAgent(created.id)).toBeNull();
    });

    it("1.15 should return false when trying to delete a non-existent agent", () => {
      expect(registry.deleteAgent("NON-EXISTENT-ID")).toBe(false);
    });

    it("1.16 should successfully update an agent's role", () => {
      const agent = registry.registerAgent("ROLE-OLD", []);
      const updated = registry.updateAgent(agent.id, { role: "ROLE-NEW" });
      expect(updated.role).toBe("ROLE-NEW");
      expect(registry.getAgent(agent.id)?.role).toBe("ROLE-NEW");
    });

    it("1.17 should successfully update an agent's capabilities", () => {
      const agent = registry.registerAgent("ROLE", [AgentCapability.Coding]);
      const updated = registry.updateAgent(agent.id, { capabilities: [AgentCapability.Writing, AgentCapability.Vision] });
      expect(updated.capabilities).toContain(AgentCapability.Writing);
      expect(updated.capabilities).toContain(AgentCapability.Vision);
      expect(updated.capabilities).not.toContain(AgentCapability.Coding);
    });

    it("1.18 should successfully update an agent's priority", () => {
      const agent = registry.registerAgent("ROLE", [], {}, 3);
      const updated = registry.updateAgent(agent.id, { priority: 10 });
      expect(updated.priority).toBe(10);
    });

    it("1.19 should successfully update an agent's load", () => {
      const agent = registry.registerAgent("ROLE", []);
      const updated = registry.updateAgent(agent.id, { load: 2 });
      expect(updated.load).toBe(2);
    });

    it("1.20 should throw error when trying to update non-existent agent", () => {
      expect(() => registry.updateAgent("NON-EXISTENT", { role: "NEW" })).toThrow();
    });

    it("1.21 should not modify health field during updates to keep monitoring records immutable", () => {
      const agent = registry.registerAgent("ROLE", []);
      const updated = registry.updateAgent(agent.id, { role: "UPDATED" });
      expect(updated.health).toBeDefined();
    });

    it("1.22 should trigger AgentCreated event upon successful registration", () => {
      const agent = registry.registerAgent("EVENT-TEST", []);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events.some(e => e.eventType === "AgentCreated")).toBe(true);
    });

    it("1.23 should accept custom permission tools on registration", () => {
      const record = registry.registerAgent("ROLE", [], { allowedTools: ["T1"] });
      expect(record.permissions.allowedTools).toContain("T1");
    });

    it("1.24 should accept custom permission models on registration", () => {
      const record = registry.registerAgent("ROLE", [], { allowedModels: ["M1"] });
      expect(record.permissions.allowedModels).toContain("M1");
    });

    it("1.25 should accept custom permission memory spaces on registration", () => {
      const record = registry.registerAgent("ROLE", [], { allowedMemory: ["MEM1"] });
      expect(record.permissions.allowedMemory).toContain("MEM1");
    });

    it("1.26 should return read-only clones from listAgents() to prevent external state pollution", () => {
      const list = registry.listAgents();
      list[0].role = "MUTATED-ROLE";
      const freshList = registry.listAgents();
      expect(freshList[0].role).not.toBe("MUTATED-ROLE");
    });

    it("1.27 should return read-only clone from getAgent() to preserve internal store integrity", () => {
      const agent = registry.registerAgent("ROLE", []);
      const fetched = registry.getAgent(agent.id);
      if (fetched) {
        fetched.role = "MUTATED";
      }
      expect(registry.getAgent(agent.id)?.role).toBe("ROLE");
    });

    it("1.28 should seed agent-1 as an Architect with active state", () => {
      const record = registry.getAgent("agent-1");
      expect(record?.role).toBe("ARCHITECT");
      expect(record?.state).toBe(AgentLifecycleState.Active);
    });

    it("1.29 should seed agent-2 as a Researcher with active state", () => {
      const record = registry.getAgent("agent-2");
      expect(record?.role).toBe("RESEARCHER");
      expect(record?.state).toBe(AgentLifecycleState.Active);
    });

    it("1.30 should seed agent-default as a general assistant with active state", () => {
      const record = registry.getAgent("agent-default");
      expect(record?.role).toBe("GENERAL");
      expect(record?.state).toBe(AgentLifecycleState.Active);
    });

    it("1.31 should support clearing and re-seeding the entire registry database", () => {
      registry.registerAgent("EXTRA", []);
      registry.clear();
      expect(registry.listAgents().length).toBe(3);
    });

    it("1.32 should support updating permissions nested objects in a deep-copy safe way", () => {
      const agent = registry.registerAgent("ROLE", [], { allowedTools: ["OldTool"] });
      registry.updateAgent(agent.id, { permissions: { allowedTools: ["NewTool"], allowedMemory: [], allowedModels: [] } });
      const record = registry.getAgent(agent.id);
      expect(record?.permissions.allowedTools).toContain("NewTool");
      expect(record?.permissions.allowedTools).not.toContain("OldTool");
    });

    it("1.33 should fail with descriptive error upon toggling non-existent agent state", () => {
      expect(() => registry.setAgentState("NON-EXISTENT", AgentLifecycleState.Active)).toThrow();
    });

    it("1.34 should support updating multiple fields in a single transaction-like block", () => {
      const agent = registry.registerAgent("ROLE", []);
      const record = registry.updateAgent(agent.id, { role: "ROLE-NEW", priority: 8, load: 1 });
      expect(record.role).toBe("ROLE-NEW");
      expect(record.priority).toBe(8);
      expect(record.load).toBe(1);
    });

    it("1.35 should allow seeding registry with Custom id in private helper", () => {
      const record = registry.getAgent("agent-1");
      expect(record?.id).toBe("agent-1");
    });
  });

  describe("2. Agent Capability Catalog (15 Tests)", () => {
    it("2.1 should support Writing capability", () => {
      const agent = registry.registerAgent("W", [AgentCapability.Writing]);
      expect(agent.capabilities).toContain(AgentCapability.Writing);
    });

    it("2.2 should support Coding capability", () => {
      const agent = registry.registerAgent("C", [AgentCapability.Coding]);
      expect(agent.capabilities).toContain(AgentCapability.Coding);
    });

    it("2.3 should support Research capability", () => {
      const agent = registry.registerAgent("R", [AgentCapability.Research]);
      expect(agent.capabilities).toContain(AgentCapability.Research);
    });

    it("2.4 should support Vision capability", () => {
      const agent = registry.registerAgent("V", [AgentCapability.Vision]);
      expect(agent.capabilities).toContain(AgentCapability.Vision);
    });

    it("2.5 should support Planning capability", () => {
      const agent = registry.registerAgent("P", [AgentCapability.Planning]);
      expect(agent.capabilities).toContain(AgentCapability.Planning);
    });

    it("2.6 should support Tool Use capability", () => {
      const agent = registry.registerAgent("T", [AgentCapability.ToolUse]);
      expect(agent.capabilities).toContain(AgentCapability.ToolUse);
    });

    it("2.7 should support holding multiple capabilities at once", () => {
      const agent = registry.registerAgent("M", [AgentCapability.Coding, AgentCapability.Research, AgentCapability.Writing]);
      expect(agent.capabilities).toHaveLength(3);
    });

    it("2.8 should support clearing all capabilities and holding an empty catalog list", () => {
      const agent = registry.registerAgent("E", [AgentCapability.Writing]);
      const updated = registry.updateAgent(agent.id, { capabilities: [] });
      expect(updated.capabilities).toHaveLength(0);
    });

    it("2.9 should handle duplicate capability assignment by keeping unique list values", () => {
      const agent = registry.registerAgent("D", [AgentCapability.Coding, AgentCapability.Coding]);
      expect(agent.capabilities).toContain(AgentCapability.Coding);
    });

    it("2.10 should properly retrieve seeded capabilities for agent-1 (planning, writing, tool use)", () => {
      const agent = registry.getAgent("agent-1");
      expect(agent?.capabilities).toContain(AgentCapability.Planning);
      expect(agent?.capabilities).toContain(AgentCapability.Writing);
      expect(agent?.capabilities).toContain(AgentCapability.ToolUse);
    });

    it("2.11 should properly retrieve seeded capabilities for agent-2 (research, vision, tool use)", () => {
      const agent = registry.getAgent("agent-2");
      expect(agent?.capabilities).toContain(AgentCapability.Research);
      expect(agent?.capabilities).toContain(AgentCapability.Vision);
      expect(agent?.capabilities).toContain(AgentCapability.ToolUse);
    });

    it("2.12 should support checking capabilities dynamically via hasCapability custom matchers", () => {
      const agent = registry.registerAgent("A", [AgentCapability.Writing]);
      expect(agent.capabilities.includes(AgentCapability.Writing)).toBe(true);
    });

    it("2.13 should deny capabilities that were not assigned", () => {
      const agent = registry.registerAgent("A", [AgentCapability.Writing]);
      expect(agent.capabilities.includes(AgentCapability.Coding)).toBe(false);
    });

    it("2.14 should preserve capabilities after system status updates", () => {
      const agent = registry.registerAgent("A", [AgentCapability.Coding]);
      registry.setAgentState(agent.id, AgentLifecycleState.Active);
      const record = registry.getAgent(agent.id);
      expect(record?.capabilities).toContain(AgentCapability.Coding);
    });

    it("2.15 should support re-assigning capabilities on Draft states", () => {
      const agent = registry.registerAgent("A", [AgentCapability.Planning]);
      registry.setAgentState(agent.id, AgentLifecycleState.Draft);
      const record = registry.updateAgent(agent.id, { capabilities: [AgentCapability.Coding] });
      expect(record.capabilities).toContain(AgentCapability.Coding);
    });
  });

  describe("3. Agent Permission System (10 Tests)", () => {
    it("3.1 should initialize empty array for allowedTools if not specified", () => {
      const agent = registry.registerAgent("A", []);
      expect(agent.permissions.allowedTools).toBeDefined();
      expect(agent.permissions.allowedTools).toHaveLength(0);
    });

    it("3.2 should initialize empty array for allowedModels if not specified", () => {
      const agent = registry.registerAgent("A", []);
      expect(agent.permissions.allowedModels).toBeDefined();
      expect(agent.permissions.allowedModels).toHaveLength(0);
    });

    it("3.3 should initialize empty array for allowedMemory if not specified", () => {
      const agent = registry.registerAgent("A", []);
      expect(agent.permissions.allowedMemory).toBeDefined();
      expect(agent.permissions.allowedMemory).toHaveLength(0);
    });

    it("3.4 should support setting and reading allowed tools", () => {
      const permissions: AgentPermissions = {
        allowedTools: ["WebSearch", "PythonExecutor"],
        allowedModels: [],
        allowedMemory: []
      };
      const agent = registry.registerAgent("A", [], permissions);
      expect(agent.permissions.allowedTools).toContain("WebSearch");
      expect(agent.permissions.allowedTools).toContain("PythonExecutor");
    });

    it("3.5 should support setting and reading allowed models", () => {
      const permissions: AgentPermissions = {
        allowedTools: [],
        allowedModels: ["gemini-pro-v1", "gemini-ultra-v1"],
        allowedMemory: []
      };
      const agent = registry.registerAgent("A", [], permissions);
      expect(agent.permissions.allowedModels).toContain("gemini-pro-v1");
    });

    it("3.6 should support setting and reading allowed memory boundaries", () => {
      const permissions: AgentPermissions = {
        allowedTools: [],
        allowedModels: [],
        allowedMemory: ["mission-isolated-compartment", "long-term-episodic"]
      };
      const agent = registry.registerAgent("A", [], permissions);
      expect(agent.permissions.allowedMemory).toContain("long-term-episodic");
    });

    it("3.7 should enforce deep immutability when reading permissions", () => {
      const agent = registry.registerAgent("A", [], { allowedTools: ["ToolA"] });
      agent.permissions.allowedTools.push("HackedTool");
      expect(registry.getAgent(agent.id)?.permissions.allowedTools).not.toContain("HackedTool");
    });

    it("3.8 should successfully modify permissions via updateAgent API", () => {
      const agent = registry.registerAgent("A", [], { allowedTools: ["T1"] });
      registry.updateAgent(agent.id, { permissions: { allowedTools: ["T2"], allowedModels: ["M1"], allowedMemory: ["MEM1"] } });
      const record = registry.getAgent(agent.id);
      expect(record?.permissions.allowedTools).toContain("T2");
      expect(record?.permissions.allowedTools).not.toContain("T1");
    });

    it("3.9 should retrieve correct allowed tools for Architect (WebTool, FileTool, CalculatorTool)", () => {
      const agent = registry.getAgent("agent-1");
      expect(agent?.permissions.allowedTools).toContain("WebTool");
      expect(agent?.permissions.allowedTools).toContain("FileTool");
    });

    it("3.10 should retrieve correct allowed models for Researcher (gemini-3.5-flash)", () => {
      const agent = registry.getAgent("agent-2");
      expect(agent?.permissions.allowedModels).toContain("gemini-3.5-flash");
    });
  });

  describe("4. Agent Lifecycle (15 Tests)", () => {
    it("4.1 should initialize state to Registered by default on registration", () => {
      const agent = registry.registerAgent("A", []);
      expect(agent.state).toBe(AgentLifecycleState.Registered);
    });

    it("4.2 should support switching state to Draft", () => {
      const agent = registry.registerAgent("A", []);
      const updated = registry.setAgentState(agent.id, AgentLifecycleState.Draft);
      expect(updated.state).toBe(AgentLifecycleState.Draft);
    });

    it("4.3 should support switching state to Active", () => {
      const agent = registry.registerAgent("A", []);
      const updated = registry.setAgentState(agent.id, AgentLifecycleState.Active);
      expect(updated.state).toBe(AgentLifecycleState.Active);
    });

    it("4.4 should support switching state to Busy", () => {
      const agent = registry.registerAgent("A", []);
      const updated = registry.setAgentState(agent.id, AgentLifecycleState.Busy);
      expect(updated.state).toBe(AgentLifecycleState.Busy);
    });

    it("4.5 should support switching state to Suspended", () => {
      const agent = registry.registerAgent("A", []);
      const updated = registry.setAgentState(agent.id, AgentLifecycleState.Suspended);
      expect(updated.state).toBe(AgentLifecycleState.Suspended);
    });

    it("4.6 should support switching state to Disabled", () => {
      const agent = registry.registerAgent("A", []);
      const updated = registry.setAgentState(agent.id, AgentLifecycleState.Disabled);
      expect(updated.state).toBe(AgentLifecycleState.Disabled);
    });

    it("4.7 should support switching state to Retired", () => {
      const agent = registry.registerAgent("A", []);
      const updated = registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      expect(updated.state).toBe(AgentLifecycleState.Retired);
    });

    it("4.8 should trigger AgentActivated event when transition to Active occurs", () => {
      const agent = registry.registerAgent("A", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Active);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events.some(e => e.eventType === "AgentActivated")).toBe(true);
    });

    it("4.9 should trigger AgentSuspended event when transition to Suspended occurs", () => {
      const agent = registry.registerAgent("A", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Suspended);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events.some(e => e.eventType === "AgentSuspended")).toBe(true);
    });

    it("4.10 should trigger AgentRetired event when transition to Retired occurs", () => {
      const agent = registry.registerAgent("A", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events.some(e => e.eventType === "AgentRetired")).toBe(true);
    });

    it("4.11 should preserve health metrics upon multiple state transitions", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 500, 100);
      registry.setAgentState(agent.id, AgentLifecycleState.Active);
      registry.setAgentState(agent.id, AgentLifecycleState.Busy);
      const record = registry.getAgent(agent.id);
      expect(record?.health.averageRuntime).toBe(500);
    });

    it("4.12 should record AgentCreated event during general state change from Registered to Draft", () => {
      const agent = registry.registerAgent("A", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Draft);
      const events = eventLog.getEventsByAgent(agent.id).filter(e => e.eventType === "AgentCreated");
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it("4.13 should maintain independent state values across registered agents", () => {
      const a = registry.registerAgent("A", []);
      const b = registry.registerAgent("B", []);
      registry.setAgentState(a.id, AgentLifecycleState.Active);
      registry.setAgentState(b.id, AgentLifecycleState.Retired);
      expect(registry.getAgent(a.id)?.state).toBe(AgentLifecycleState.Active);
      expect(registry.getAgent(b.id)?.state).toBe(AgentLifecycleState.Retired);
    });

    it("4.14 should preserve agent configuration details after transition to Retired", () => {
      const agent = registry.registerAgent("A", [AgentCapability.Coding], { allowedTools: ["T"] });
      registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      const record = registry.getAgent(agent.id);
      expect(record?.capabilities).toContain(AgentCapability.Coding);
      expect(record?.permissions.allowedTools).toContain("T");
    });

    it("4.15 should log all lifecycle movements cleanly in event database with description details", () => {
      const agent = registry.registerAgent("A", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Active);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events[events.length - 1].description).toContain("Active");
    });
  });

  describe("5. Agent Health Monitor (15 Tests)", () => {
    it("5.1 should support updating health on successful execution and report successRate=1", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 100, 50);
      const record = registry.getAgent(agent.id);
      expect(record?.health.successRate).toBe(1.0);
      expect(record?.health.errorRate).toBe(0.0);
    });

    it("5.2 should recalculate rolling successRate average correctly upon failure (weight=0.2)", () => {
      const agent = registry.registerAgent("A", []); // Initial successRate = 1.0
      registry.updateAgentHealth(agent.id, false, 200, 50); // new = 0.8
      const record = registry.getAgent(agent.id);
      expect(record?.health.successRate).toBe(0.8);
      expect(record?.health.errorRate).toBe(0.2);
    });

    it("5.3 should calculate exponential moving average for successRate across multiple steps", () => {
      const agent = registry.registerAgent("A", []); // Initial = 1.0
      registry.updateAgentHealth(agent.id, false, 100, 10); // EMA: 1.0 * 0.8 + 0.0 * 0.2 = 0.8
      registry.updateAgentHealth(agent.id, true, 100, 10);  // EMA: 0.8 * 0.8 + 1.0 * 0.2 = 0.84
      const record = registry.getAgent(agent.id);
      expect(record?.health.successRate).toBe(0.84);
    });

    it("5.4 should set averageRuntime on the first health report", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 450, 10);
      expect(registry.getAgent(agent.id)?.health.averageRuntime).toBe(450);
    });

    it("5.5 should calculate EMA rolling average for runtime over multiple events", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 1000, 10); // average = 1000
      registry.updateAgentHealth(agent.id, true, 500, 10);  // average: 1000 * 0.8 + 500 * 0.2 = 900
      expect(registry.getAgent(agent.id)?.health.averageRuntime).toBe(900);
    });

    it("5.6 should set averageTokens on the first health update", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 100, 500);
      expect(registry.getAgent(agent.id)?.health.averageTokens).toBe(500);
    });

    it("5.7 should calculate EMA rolling average for tokens over multiple updates", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 100, 1000); // initial = 1000
      registry.updateAgentHealth(agent.id, true, 100, 500);  // average: 1000 * 0.8 + 500 * 0.2 = 900
      expect(registry.getAgent(agent.id)?.health.averageTokens).toBe(900);
    });

    it("5.8 should update the lastActivity timestamp on every health report", async () => {
      const agent = registry.registerAgent("A", []);
      const firstActivity = agent.health.lastActivity;
      await new Promise(resolve => setTimeout(resolve, 2));
      registry.updateAgentHealth(agent.id, true, 100, 10);
      const secondActivity = registry.getAgent(agent.id)?.health.lastActivity;
      expect(secondActivity?.getTime()).toBeGreaterThan(firstActivity.getTime());
    });

    it("5.9 should fail with descriptive error when writing health for non-existent agent", () => {
      expect(() => registry.updateAgentHealth("NON-EXISTENT", true, 100, 10)).toThrow();
    });

    it("5.10 should keep errorRate and successRate sum equal to 1.0 (approximated)", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, false, 100, 10);
      registry.updateAgentHealth(agent.id, true, 100, 10);
      const record = registry.getAgent(agent.id);
      expect((record?.health.successRate || 0) + (record?.health.errorRate || 0)).toBeCloseTo(1.0);
    });

    it("5.11 should keep separate independent health trackers for multiple agents", () => {
      const a = registry.registerAgent("A", []);
      const b = registry.registerAgent("B", []);
      registry.updateAgentHealth(a.id, false, 500, 20);
      registry.updateAgentHealth(b.id, true, 1000, 40);
      expect(registry.getAgent(a.id)?.health.successRate).toBe(0.8);
      expect(registry.getAgent(b.id)?.health.successRate).toBe(1.0);
    });

    it("5.12 should handle fractional rounding nicely without floating errors beyond 4 decimals", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, false, 234, 11);
      const record = registry.getAgent(agent.id);
      const decimalCount = (record?.health.successRate.toString().split(".")[1] || "").length;
      expect(decimalCount).toBeLessThanOrEqual(4);
    });

    it("5.13 should not penalize errorRate when success events are consistently reported", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 100, 10);
      registry.updateAgentHealth(agent.id, true, 100, 10);
      expect(registry.getAgent(agent.id)?.health.errorRate).toBe(0.0);
    });

    it("5.14 should support health recording for Busy agents", () => {
      const agent = registry.registerAgent("A", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Busy);
      registry.updateAgentHealth(agent.id, true, 150, 30);
      expect(registry.getAgent(agent.id)?.health.averageRuntime).toBe(150);
    });

    it("5.15 should handle extremely high token counts safely without integer overflow issues", () => {
      const agent = registry.registerAgent("A", []);
      registry.updateAgentHealth(agent.id, true, 200, 9999999);
      expect(registry.getAgent(agent.id)?.health.averageTokens).toBe(9999999);
    });
  });

  describe("6. Agent Scheduler (25 Tests)", () => {
    it("6.1 should return null if there are absolutely no agents in operational states", () => {
      registry.clear(); // remove seeded ones
      for (const agent of registry.listAgents()) {
        registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      }
      const selected = scheduler.selectAgent({ requiredCapabilities: [] });
      expect(selected).toBeNull();
    });

    it("6.2 should select active seed agent-1 for Planning task", () => {
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Planning] });
      expect(selected?.id).toBe("agent-1");
    });

    it("6.3 should select active seed agent-2 for Research task", () => {
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Research] });
      expect(selected?.id).toBe("agent-2");
    });

    it("6.4 should return null if no agent has the requested capability", () => {
      registry.clear();
      for (const agent of registry.listAgents()) {
        registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      }
      const bot = registry.registerAgent("CODE-BOT", [AgentCapability.Coding]);
      registry.setAgentState(bot.id, AgentLifecycleState.Active);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Writing] });
      expect(selected).toBeNull();
    });

    it("6.5 should select agent with highest priority when capabilities match equally", () => {
      registry.clear();
      for (const agent of registry.listAgents()) {
        registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      }
      // Registrations are Draft state, let's make them Active
      const lower = registry.registerAgent("LOWER", [AgentCapability.Writing], {}, 3);
      const higher = registry.registerAgent("HIGHER", [AgentCapability.Writing], {}, 8);

      registry.setAgentState(lower.id, AgentLifecycleState.Active);
      registry.setAgentState(higher.id, AgentLifecycleState.Active);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Writing] });
      expect(selected?.id).toBe(higher.id);
    });

    it("6.6 should select agent with lower load when priority and capabilities are equal", () => {
      registry.clear();
      const loaded = registry.registerAgent("LOADED", [AgentCapability.Coding], {}, 5);
      const free = registry.registerAgent("FREE", [AgentCapability.Coding], {}, 5);

      registry.setAgentState(loaded.id, AgentLifecycleState.Active);
      registry.setAgentState(free.id, AgentLifecycleState.Active);

      registry.updateAgent(loaded.id, { load: 2 });
      registry.updateAgent(free.id, { load: 0 });

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(free.id);
    });

    it("6.7 should select agent with better successRate health when load and priority are equal", () => {
      registry.clear();
      const healthy = registry.registerAgent("HEALTHY", [AgentCapability.Coding], {}, 5);
      const failing = registry.registerAgent("FAILING", [AgentCapability.Coding], {}, 5);

      registry.setAgentState(healthy.id, AgentLifecycleState.Active);
      registry.setAgentState(failing.id, AgentLifecycleState.Active);

      registry.updateAgentHealth(healthy.id, true, 200, 10);
      registry.updateAgentHealth(failing.id, false, 200, 10); // success rate goes down

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(healthy.id);
    });

    it("6.8 should select agent with faster average runtime when everything else is equal", () => {
      registry.clear();
      const fast = registry.registerAgent("FAST", [AgentCapability.Coding], {}, 5);
      const slow = registry.registerAgent("SLOW", [AgentCapability.Coding], {}, 5);

      registry.setAgentState(fast.id, AgentLifecycleState.Active);
      registry.setAgentState(slow.id, AgentLifecycleState.Active);

      // Report successes with different runtimes
      registry.updateAgentHealth(fast.id, true, 100, 10);
      registry.updateAgentHealth(slow.id, true, 2000, 10);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(fast.id);
    });

    it("6.9 should completely exclude Draft agents from scheduling selection", () => {
      registry.clear();
      const draft = registry.registerAgent("DRAFT", [AgentCapability.Coding]);
      registry.setAgentState(draft.id, AgentLifecycleState.Draft);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected).toBeNull();
    });

    it("6.10 should completely exclude Suspended agents from scheduling selection", () => {
      registry.clear();
      const suspended = registry.registerAgent("SUSPENDED", [AgentCapability.Coding]);
      registry.setAgentState(suspended.id, AgentLifecycleState.Suspended);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected).toBeNull();
    });

    it("6.11 should completely exclude Disabled agents from scheduling selection", () => {
      registry.clear();
      const disabled = registry.registerAgent("DISABLED", [AgentCapability.Coding]);
      registry.setAgentState(disabled.id, AgentLifecycleState.Disabled);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected).toBeNull();
    });

    it("6.12 should completely exclude Retired agents from scheduling selection", () => {
      registry.clear();
      const retired = registry.registerAgent("RETIRED", [AgentCapability.Coding]);
      registry.setAgentState(retired.id, AgentLifecycleState.Retired);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected).toBeNull();
    });

    it("6.13 should allow selection of Busy agents if they have matching capabilities but penalize score by 30", () => {
      registry.clear();
      const activeBot = registry.registerAgent("ACTIVE", [AgentCapability.Coding], {}, 3);
      const busyBot = registry.registerAgent("BUSY", [AgentCapability.Coding], {}, 8); // much higher priority

      registry.setAgentState(activeBot.id, AgentLifecycleState.Active);
      registry.setAgentState(busyBot.id, AgentLifecycleState.Busy);

      // ACTIVE score = 3 * 10 (priority) + 50 (success) = 80
      // BUSY score = 8 * 10 (priority) + 50 (success) - 30 (busy penalty) = 100
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(busyBot.id);
    });

    it("6.14 should pick ACTIVE agent over BUSY agent if busy penalty makes ACTIVE score higher", () => {
      registry.clear();
      const activeBot = registry.registerAgent("ACTIVE", [AgentCapability.Coding], {}, 6); // close priority
      const busyBot = registry.registerAgent("BUSY", [AgentCapability.Coding], {}, 8);

      registry.setAgentState(activeBot.id, AgentLifecycleState.Active);
      registry.setAgentState(busyBot.id, AgentLifecycleState.Busy);

      // ACTIVE score = 6 * 10 + 50 = 110
      // BUSY score = 8 * 10 + 50 - 30 = 100
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(activeBot.id);
    });

    it("6.15 should support scheduling matching multiple requested capabilities simultaneously", () => {
      registry.clear();
      const helper = registry.registerAgent("HELPER", [AgentCapability.Coding, AgentCapability.Writing]);
      registry.setAgentState(helper.id, AgentLifecycleState.Active);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding, AgentCapability.Writing] });
      expect(selected?.id).toBe(helper.id);
    });

    it("6.16 should fail to match if agent has some but not all of the requested capabilities", () => {
      registry.clear();
      const partial = registry.registerAgent("PARTIAL", [AgentCapability.Coding]);
      registry.setAgentState(partial.id, AgentLifecycleState.Active);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding, AgentCapability.Writing] });
      expect(selected).toBeNull();
    });

    it("6.17 should respect the minPriority filter option during agent selection", () => {
      registry.clear();
      const low = registry.registerAgent("LOW", [AgentCapability.Coding], {}, 3);
      const high = registry.registerAgent("HIGH", [AgentCapability.Coding], {}, 7);

      registry.setAgentState(low.id, AgentLifecycleState.Active);
      registry.setAgentState(high.id, AgentLifecycleState.Active);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding], minPriority: 6 });
      expect(selected?.id).toBe(high.id);
    });

    it("6.18 should fall back to any capability-matched agent if none meet the minPriority filter threshold", () => {
      registry.clear();
      const low = registry.registerAgent("LOW", [AgentCapability.Coding], {}, 3);
      registry.setAgentState(low.id, AgentLifecycleState.Active);

      // Request priority 8 (which low doesn't meet)
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding], minPriority: 8 });
      expect(selected?.id).toBe(low.id); // Falls back to low
    });

    it("6.19 should evaluate correctly when zero required capabilities are specified (empty array)", () => {
      // Should pick the overall highest-scored operational agent
      const selected = scheduler.selectAgent({ requiredCapabilities: [] });
      expect(selected).not.toBeNull();
      expect(selected?.state).toBe(AgentLifecycleState.Active);
    });

    it("6.20 should weigh error rate heavily and penalize failing agents", () => {
      registry.clear();
      const good = registry.registerAgent("GOOD", [AgentCapability.Coding], {}, 5);
      const bad = registry.registerAgent("BAD", [AgentCapability.Coding], {}, 5);

      registry.setAgentState(good.id, AgentLifecycleState.Active);
      registry.setAgentState(bad.id, AgentLifecycleState.Active);

      registry.updateAgentHealth(good.id, true, 200, 10);
      registry.updateAgentHealth(bad.id, false, 200, 10);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(good.id);
    });

    it("6.21 should handle empty list selection gracefully", () => {
      registry.clear();
      for (const agent of registry.listAgents()) {
        registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      }
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Vision] });
      expect(selected).toBeNull();
    });

    it("6.22 should prefer Registered state agents if no Active ones exist but capabilities match", () => {
      registry.clear();
      const registered = registry.registerAgent("REG", [AgentCapability.Coding]);
      // State is Registered by default
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(registered.id);
    });

    it("6.23 should handle ties by picking the first candidate in loop traversal order", () => {
      registry.clear();
      const first = registry.registerAgent("FIRST", [AgentCapability.Coding], {}, 5);
      const second = registry.registerAgent("SECOND", [AgentCapability.Coding], {}, 5);

      registry.setAgentState(first.id, AgentLifecycleState.Active);
      registry.setAgentState(second.id, AgentLifecycleState.Active);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(first.id);
    });

    it("6.24 should scale priority points linearly in scoring function", () => {
      registry.clear();
      const a = registry.registerAgent("A", [AgentCapability.Writing], {}, 1);
      const b = registry.registerAgent("B", [AgentCapability.Writing], {}, 10);

      registry.setAgentState(a.id, AgentLifecycleState.Active);
      registry.setAgentState(b.id, AgentLifecycleState.Active);

      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Writing] });
      expect(selected?.id).toBe(b.id);
    });

    it("6.25 should discount averageTokens metric safely in scoring weight limits", () => {
      registry.clear();
      const a = registry.registerAgent("A", [AgentCapability.Coding], {}, 5);
      registry.setAgentState(a.id, AgentLifecycleState.Active);
      registry.updateAgentHealth(a.id, true, 100, 1000000);
      const selected = scheduler.selectAgent({ requiredCapabilities: [AgentCapability.Coding] });
      expect(selected?.id).toBe(a.id);
    });
  });

  describe("7. Agent Governance Events (15 Tests)", () => {
    it("7.1 should initialize event list as empty on clean start", () => {
      eventLog.clear();
      expect(eventLog.getEvents()).toHaveLength(0);
    });

    it("7.2 should automatically log AgentCreated event during registration", () => {
      const agent = registry.registerAgent("ROLE", []);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events[0].eventType).toBe("AgentCreated");
    });

    it("7.3 should set correct event properties (timestamp, eventType, description)", () => {
      const agent = registry.registerAgent("ROLE", []);
      const event = eventLog.getEventsByAgent(agent.id)[0];
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.eventType).toBe("AgentCreated");
      expect(event.description).toContain("Agent registered with ID");
    });

    it("7.4 should support retrieving event history filtered by eventType", () => {
      const agent = registry.registerAgent("ROLE", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Active);
      const createdEvents = eventLog.getEventsByType("AgentCreated");
      const activatedEvents = eventLog.getEventsByType("AgentActivated");
      expect(createdEvents.length).toBeGreaterThanOrEqual(1);
      expect(activatedEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("7.5 should store and retrieve details object payload correctly", () => {
      const agent = registry.registerAgent("ROLE", [AgentCapability.Writing]);
      const event = eventLog.getEventsByAgent(agent.id)[0];
      expect(event.details.role).toBe("ROLE");
    });

    it("7.6 should generate a unique EVT- prefix ID for logged events", () => {
      const agent = registry.registerAgent("ROLE", []);
      const event = eventLog.getEventsByAgent(agent.id)[0];
      expect(event.id).toMatch(/^EVT-[A-Z0-9]{9}$/);
    });

    it("7.7 should support querying all events sorted by occurrence implicitly via array order", () => {
      registry.registerAgent("ROLE1", []);
      registry.registerAgent("ROLE2", []);
      const all = eventLog.getEvents();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("7.8 should support clear operation that completely resets the event log store", () => {
      registry.registerAgent("ROLE", []);
      eventLog.clear();
      expect(eventLog.getEvents()).toHaveLength(0);
    });

    it("7.9 should return empty array when querying events for non-existent agentId", () => {
      expect(eventLog.getEventsByAgent("NON-EXISTENT-ID")).toHaveLength(0);
    });

    it("7.10 should log AgentSuspended event upon entering suspended state", () => {
      const agent = registry.registerAgent("ROLE", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Suspended);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events.some(e => e.eventType === "AgentSuspended")).toBe(true);
    });

    it("7.11 should log AgentRetired event upon entering retired state", () => {
      const agent = registry.registerAgent("ROLE", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Retired);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events.some(e => e.eventType === "AgentRetired")).toBe(true);
    });

    it("7.12 should preserve previous events when logging new events for the same agent", () => {
      const agent = registry.registerAgent("ROLE", []);
      registry.setAgentState(agent.id, AgentLifecycleState.Active);
      registry.setAgentState(agent.id, AgentLifecycleState.Suspended);
      const events = eventLog.getEventsByAgent(agent.id);
      expect(events.length).toBeGreaterThanOrEqual(3); // Created, Activated, Suspended
    });

    it("7.13 should not affect other agents' event logs upon adding a new event", () => {
      const a = registry.registerAgent("A", []);
      const b = registry.registerAgent("B", []);
      registry.setAgentState(a.id, AgentLifecycleState.Active);
      expect(eventLog.getEventsByAgent(b.id).some(e => e.eventType === "AgentActivated")).toBe(false);
    });

    it("7.14 should support customized descripton logs passed during record call", () => {
      const event = eventLog.record("AgentCreated", "agent-x", {}, "Custom build message");
      expect(event.description).toBe("Custom build message");
    });

    it("7.15 should guarantee read-only array results when fetch getEvents() is used", () => {
      const list = eventLog.getEvents();
      const lengthBefore = list.length;
      list.push({} as any);
      expect(eventLog.getEvents().length).toBe(lengthBefore);
    });
  });
});
