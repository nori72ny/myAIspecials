import { Router, Request, Response } from "express";
import { organizationExecutorInstance } from "./OrganizationExecutor";

export const createOrganizationRouter = (): Router => {
  const router = Router();
  const executor = organizationExecutorInstance;

  // 1. GET ALL ORGANIZATIONS
  router.get("/", (req: Request, res: Response) => {
    try {
      const states = executor.listOrganizationStates();
      res.json({ success: true, count: states.length, data: states });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. GET CURRENT METRICS
  router.get("/metrics", (req: Request, res: Response) => {
    try {
      const metrics = executor.getMetricsTracker().getAllMetrics();
      res.json({ success: true, data: metrics });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. GET SPECIFIC ORGANIZATION DETAILS
  router.get("/:orgId", (req: Request, res: Response) => {
    const { orgId } = req.params;
    try {
      const state = executor.getOrganizationState(orgId);
      if (!state) {
        res.status(404).json({ success: false, error: `Organization with ID ${orgId} not found.` });
        return;
      }
      res.json({ success: true, data: state });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. CREATE NEW ORGANIZATION
  router.post("/", (req: Request, res: Response) => {
    const { missionId, name } = req.body;
    if (!missionId) {
      res.status(400).json({ success: false, error: "Missing required parameter: missionId" });
      return;
    }

    try {
      const state = executor.createOrganization(missionId, name || "Enterprise Squad");
      res.status(201).json({ success: true, data: state });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. TRIGGER AUTOMATED CORPORATE EXECUTION
  router.post("/:orgId/execute", async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const { description } = req.body;

    try {
      const state = executor.getOrganizationState(orgId);
      if (!state) {
        res.status(404).json({ success: false, error: `Organization with ID ${orgId} not found.` });
        return;
      }

      const finalState = await executor.runExecutionLoop(orgId, description || "Default task");
      res.json({ success: true, data: finalState });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. SERVER-SENT EVENTS (SSE) FOR REAL-TIME CLIENTS
  router.get("/:orgId/sse", (req: Request, res: Response) => {
    const { orgId } = req.params;
    
    // Set headers for SSE stream
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders(); // Establishes stream with client

    // Periodically send simulated organization state update ticks
    const intervalId = setInterval(() => {
      const state = executor.getOrganizationState(orgId);
      if (state) {
        res.write(`data: ${JSON.stringify(state)}\n\n`);
      } else {
        res.write(`data: {"error": "Org not found"}\n\n`);
      }
    }, 2000);

    req.on("close", () => {
      clearInterval(intervalId);
      res.end();
    });
  });

  // 7. MOCKED WEBSOCKET HANDSHAKE ROUTE
  // Facilitates browser WS protocol handshake requests gracefully
  router.get("/ws-handshake", (req: Request, res: Response) => {
    res.json({
      success: true,
      protocol: "WebSocket",
      endpoint: `ws://${req.headers.host}/api/v2/organizations/live`,
      instructions: "Initiate upgrading connection headers with Sec-WebSocket-Key."
    });
  });

  return router;
};
export default createOrganizationRouter;
