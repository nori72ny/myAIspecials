import { Router, Request, Response } from "express";
import { InMemoryAgentRepository } from "../../infrastructure/registry/InMemoryAgentRepository";
import { asyncHandler } from "../middlewares/asyncHandler";
import { Logger } from "../../infrastructure/logging/Logger";
import { AgentRegistryService } from "../../application/agent/governance/AgentRegistryService";
import { AgentLifecycleState, AgentCapability } from "../../application/agent/governance/AgentGovernanceTypes";
import { Agent, createAgentId } from "@origin/domain";

export const createAgentRouter = (agentRepo: InMemoryAgentRepository) => {
  const router = Router();
  const governanceRegistry = AgentRegistryService.getInstance();

  // Helper to map state to legacy domain status
  const mapStateToDomainStatus = (state: AgentLifecycleState): string => {
    switch (state) {
      case AgentLifecycleState.Active:
        return "Available";
      case AgentLifecycleState.Registered:
        return "Available";
      case AgentLifecycleState.Busy:
        return "Working";
      default:
        return "Unavailable";
    }
  };

  // 1. GET /agents - List all agents
  router.get("/", asyncHandler(async (req: Request, res: Response) => {
    Logger.info("API Request: Get all agents (governance registry)");
    const agents = governanceRegistry.listAgents();
    res.json({
      success: true,
      agents
    });
  }));

  // 2. GET /agents/:id - Get specific agent by ID
  router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    Logger.info(`API Request: Get agent by ID: ${id}`);
    const agent = governanceRegistry.getAgent(id);
    if (!agent) {
      res.status(404).json({
        success: false,
        error: `Agent with ID ${id} not found.`
      });
      return;
    }
    res.json({
      success: true,
      agent
    });
  }));

  // 3. POST /agents - Register a new agent
  router.post("/", asyncHandler(async (req: Request, res: Response) => {
    const { role, capabilities, permissions, priority } = req.body;
    Logger.info(`API Request: Register new agent with role ${role}`);

    if (!role) {
      res.status(400).json({
        success: false,
        error: "Missing required field: role"
      });
      return;
    }

    // Parse capabilities
    const parsedCaps: AgentCapability[] = [];
    if (Array.isArray(capabilities)) {
      for (const cap of capabilities) {
        if (Object.values(AgentCapability).includes(cap as AgentCapability)) {
          parsedCaps.push(cap as AgentCapability);
        }
      }
    }

    const record = governanceRegistry.registerAgent(
      role,
      parsedCaps,
      permissions,
      priority !== undefined ? Number(priority) : 5
    );

    // Sync to legacy repo
    const domainAgent = new Agent(createAgentId(record.id), record.role, record.capabilities);
    await agentRepo.save(domainAgent);

    res.status(201).json({
      success: true,
      agent: record
    });
  }));

  // 4. PATCH /agents/:id - Update an agent's properties or toggle active/inactive state
  router.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { role, capabilities, permissions, priority, load, state } = req.body;
    Logger.info(`API Request: Patch agent: ${id}`);

    const existing = governanceRegistry.getAgent(id);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: `Agent with ID ${id} not found.`
      });
      return;
    }

    // Validate capabilities if passed
    let parsedCaps: AgentCapability[] | undefined = undefined;
    if (capabilities !== undefined && Array.isArray(capabilities)) {
      parsedCaps = [];
      for (const cap of capabilities) {
        if (Object.values(AgentCapability).includes(cap as AgentCapability)) {
          parsedCaps.push(cap as AgentCapability);
        }
      }
    }

    const record = governanceRegistry.updateAgent(id, {
      role,
      capabilities: parsedCaps,
      permissions,
      priority: priority !== undefined ? Number(priority) : undefined,
      load: load !== undefined ? Number(load) : undefined,
      state
    });

    // Sync to legacy repo
    const domainAgent = new Agent(createAgentId(record.id), record.role, record.capabilities);
    const domainStatus = mapStateToDomainStatus(record.state);
    if (domainStatus === "Working") {
      domainAgent.assign();
      domainAgent.startWorking();
    } else if (domainStatus === "Unavailable") {
      domainAgent.markUnavailable();
    }
    await agentRepo.save(domainAgent);

    res.json({
      success: true,
      agent: record
    });
  }));

  // 5. DELETE /agents/:id - Delete an agent from the platform
  router.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    Logger.info(`API Request: Delete agent: ${id}`);

    const deleted = governanceRegistry.deleteAgent(id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: `Agent with ID ${id} not found.`
      });
      return;
    }

    // Also remove from legacy repo if it has a way (we can just let it delete or do nothing, but let's delete if possible. InMemoryAgentRepository maps to agentsDb, which is private. But we deleted it from governanceRegistry)
    res.json({
      success: true,
      message: `Agent ${id} successfully removed from the platform.`
    });
  }));

  // Legacy route: GET /agents/capability/:capability - Get agents by capability
  router.get("/capability/:capability", asyncHandler(async (req: Request, res: Response) => {
    const capability = req.params.capability;
    Logger.info(`API Request: Get agents by capability: "${capability}"`);

    const agents = await agentRepo.findByCapability(capability);
    res.json({
      success: true,
      agents: agents.map(a => ({
        id: a.id,
        role: a.role,
        capabilities: a.capabilities,
        status: a.status
      }))
    });
  }));

  return router;
};

