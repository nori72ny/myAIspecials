import { Mission, MissionId, IMissionRepository, DomainInvariantViolationError } from "@origin/domain";

/**
 * InMemoryMissionRepository
 * Implements IMissionRepository with strict in-memory state tracking.
 * Ready to be replaced by a Prisma/Postgres SQL Repository in Phase 2.
 */
export class InMemoryMissionRepository implements IMissionRepository {
  // Store raw persistent objects to simulate SQL database storage row-mapping
  private missionsDb: Map<string, {
    id: string;
    objective: string;
    status: string;
    successCriteria: string[];
    version: number;
    // Map with Task IDs to simulate JSON or relation table
    taskIds: string[];
  }> = new Map();

  async save(mission: Mission, expectedVersion?: number): Promise<void> {
    // Simulation of DB Transaction boundary
    // === START TRANSACTION ===
    const existing = this.missionsDb.get(mission.id);

    if (existing) {
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new DomainInvariantViolationError(
          "OPTIMISTIC_LOCK_CONFLICT",
          `Mission ${mission.id} version conflict. Expected: ${expectedVersion}, Actual: ${existing.version}`
        );
      }
    }

    // Persist mapped data model (Anti-Corruption Layer from Domain entity to DB Schema)
    this.missionsDb.set(mission.id, {
      id: mission.id,
      objective: mission.objective,
      status: mission.status,
      successCriteria: mission.successCriteria,
      version: mission.version,
      taskIds: mission.taskGraph.getTasks()
    });
    // === COMMIT TRANSACTION ===
  }

  async findById(id: MissionId): Promise<Mission | null> {
    const row = this.missionsDb.get(id);
    if (!row) return null;

    // Simulate joining relation data and rehydrating domain aggregate root
    // In actual SQL: SELECT * FROM missions LEFT JOIN tasks ON ...
    const { TaskGraph, createTaskId } = await import("@origin/domain");
    const taskGraph = new TaskGraph();
    for (const tid of row.taskIds) {
      taskGraph.addTask(createTaskId(tid));
    }

    return Mission.rehydrate(
      id,
      row.objective,
      row.status as any,
      row.successCriteria,
      taskGraph,
      row.version
    );
  }

  // Helper to assist testing and metrics
  async count(): Promise<number> {
    return this.missionsDb.size;
  }
}

