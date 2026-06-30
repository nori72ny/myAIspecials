import { TaskId } from "../types/BrandedTypes";
import { Task } from "../mission/Task";

export interface ITaskRepository {
  findById(id: TaskId): Promise<Task | null>;
  save(task: Task): Promise<void>;
}
