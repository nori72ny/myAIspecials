import { Router } from "express";
import { MetricsCollector } from "../../infrastructure/observability/MetricsCollector";
import { asyncHandler } from "../middlewares/asyncHandler";

export const createHealthRouter = () => {
  const router = Router();

  // Basic System Health
  router.get("/", (req, res) => {
    const memoryUsage = process.memoryUsage();
    res.json({
      status: "UP",
      service: "mission-engine",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      diagnostics: {
        heapTotalMs: Math.round(memoryUsage.heapTotal / 1024 / 1024) + " MB",
        heapUsedMs: Math.round(memoryUsage.heapUsed / 1024 / 1024) + " MB",
        rss: Math.round(memoryUsage.rss / 1024 / 1024) + " MB"
      }
    });
  });

  // Detailed Observability Metrics
  router.get("/metrics", asyncHandler(async (req, res) => {
    const metricsSummary = MetricsCollector.getInstance().getMetricsSummary();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: metricsSummary
    });
  }));

  // Reset metrics (For debugging/testing purposes)
  router.post("/metrics/reset", asyncHandler(async (req, res) => {
    MetricsCollector.getInstance().clear();
    res.json({
      success: true,
      message: "Metrics cleared successfully."
    });
  }));

  return router;
};
