import { Router } from "express";
import { InMemoryTaskRepository } from "../../infrastructure/database/InMemoryTaskRepository";
import { createTaskId } from "@origin/domain";
import { asyncHandler } from "../middlewares/asyncHandler";
import { Logger } from "../../infrastructure/logging/Logger";

export const createTaskRouter = (taskRepo: InMemoryTaskRepository) => {
  const router = Router();

  router.get("/:id", asyncHandler(async (req, res) => {
    const taskIdStr = req.params.id;
    Logger.info(`API Request: Get task - ID: ${taskIdStr}`);

    const taskId = createTaskId(taskIdStr);
    const task = await taskRepo.findById(taskId);
    if (!task) {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Task ${taskIdStr} was not found`
        }
      });
      return;
    }

    res.json({
      success: true,
      task: {
        id: task.id,
        description: task.description,
        status: task.status,
        assignedAgentId: task.assignedAgentId,
        result: task.result
      }
    });
  }));

  return router;
};
