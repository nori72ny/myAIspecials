import { TaskId } from "../types/BrandedTypes";
import { CircularDependencyError } from "../errors/DomainErrors";

export class TaskGraph {
  private adjacencyList: Map<TaskId, TaskId[]> = new Map();

  addTask(taskId: TaskId): void {
    if (!this.adjacencyList.has(taskId)) {
      this.adjacencyList.set(taskId, []);
    }
  }

  addDependency(from: TaskId, to: TaskId): void {
    if (!this.adjacencyList.has(from)) this.addTask(from);
    if (!this.adjacencyList.has(to)) this.addTask(to);

    this.adjacencyList.get(from)!.push(to);

    if (this.hasCycle()) {
      // 循環依存が発生した場合はロールバック
      this.adjacencyList.get(from)!.pop();
      throw new CircularDependencyError(`Adding dependency from ${from} to ${to} creates a cycle.`);
    }
  }

  private hasCycle(): boolean {
    const visited = new Set<TaskId>();
    const recursionStack = new Set<TaskId>();

    const checkCycle = (node: TaskId): boolean => {
      visited.add(node);
      recursionStack.add(node);

      const neighbors = this.adjacencyList.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && checkCycle(neighbor)) {
          return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of this.adjacencyList.keys()) {
      if (!visited.has(node) && checkCycle(node)) {
        return true;
      }
    }
    return false;
  }
  
  getTasks(): TaskId[] {
    return Array.from(this.adjacencyList.keys());
  }
}
