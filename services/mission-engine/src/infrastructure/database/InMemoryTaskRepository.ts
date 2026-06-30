import { Task, TaskId, ITaskRepository, createTaskId, createMissionId, createAgentId } from "@origin/domain";

/**
 * InMemoryTaskRepository
 * Ready for Prisma DB substitution. Persists raw records representing DB rows.
 */
export class InMemoryTaskRepository implements ITaskRepository {
  private tasksDb: Map<string, {
    id: string;
    missionId: string;
    description: string;
    assignedAgentId?: string;
    status: string;
    result?: string;
  }> = new Map();

  async save(task: Task): Promise<void> {
    // === START TRANSACTION ===
    this.tasksDb.set(task.id, {
      id: task.id,
      missionId: task.missionId,
      description: task.description,
      assignedAgentId: task.assignedAgentId,
      status: task.status,
      result: task.result
    });
    // === COMMIT TRANSACTION ===
  }

  async findById(id: TaskId): Promise<Task | null> {
    const row = this.tasksDb.get(id);
    if (!row) return null;

    // Rehydrate Domain Entity from raw DB row data
    const task = new Task(
      createTaskId(row.id),
      createMissionId(row.missionId),
      row.description
    );
    
    if (row.assignedAgentId) {
      task.assign(createAgentId(row.assignedAgentId));
    }

    if (row.status === "InProgress") {
      task.start();
    } else if (row.status === "Completed" && row.result) {
      // Transition properly to mimic state
      task.start();
      task.complete(row.result);
    } else if (row.status === "Failed" && row.result) {
      task.start();
      task.fail(row.result);
    }

    return task;
  }
}

