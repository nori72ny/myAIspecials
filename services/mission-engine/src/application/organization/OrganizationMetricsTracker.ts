import { OrgDepartment, DepartmentMetrics, Task, Review, ReviewStatus } from "./OrganizationTypes";

export class OrganizationMetricsTracker {
  private metrics: Record<OrgDepartment, DepartmentMetrics> = {
    [OrgDepartment.Engineering]: this.createDefaultMetrics(),
    [OrgDepartment.Research]: this.createDefaultMetrics(),
    [OrgDepartment.Content]: this.createDefaultMetrics(),
    [OrgDepartment.Administration]: this.createDefaultMetrics()
  };

  private createDefaultMetrics(): DepartmentMetrics {
    return {
      productivity: 85, // base default percentage
      reviewQuality: 90,
      successRate: 1.0,
      failureRate: 0.0,
      averageTime: 3200, // ms
      improvementRate: 15 // percentage increase in score upon revisions
    };
  }

  /**
   * Retrieves current metrics for all departments.
   */
  public getAllMetrics(): Record<OrgDepartment, DepartmentMetrics> {
    return { ...this.metrics };
  }

  /**
   * Retrieves metrics for a single department.
   */
  public getDepartmentMetrics(dept: OrgDepartment): DepartmentMetrics {
    return this.metrics[dept];
  }

  /**
   * Recalculates metrics for a department based on actual tasks and reviews processed.
   */
  public updateMetrics(
    dept: OrgDepartment, 
    tasks: Task[], 
    reviews: Review[]
  ): DepartmentMetrics {
    const deptTasks = tasks.filter(t => t.department === dept);
    const completedTasks = deptTasks.filter(t => t.status === "Completed");
    const escalatedTasks = deptTasks.filter(t => t.status === "Escalated");
    
    // Calculate success/failure rates
    const totalFinished = completedTasks.length + escalatedTasks.length;
    let successRate = 1.0;
    let failureRate = 0.0;

    if (totalFinished > 0) {
      successRate = completedTasks.length / totalFinished;
      failureRate = escalatedTasks.length / totalFinished;
    }

    // Productivity: Completed tasks relative to active ones, plus rolling base
    const rawProductivity = deptTasks.length > 0 
      ? Math.round((completedTasks.length / deptTasks.length) * 100) 
      : 85;

    // Review Quality: Average review score in the department
    const deptReviews = reviews.filter(r => {
      const associatedTask = tasks.find(t => t.id === r.deliverableId.replace("del-", "task-"));
      return associatedTask && associatedTask.department === dept;
    });

    const avgReviewScore = deptReviews.length > 0
      ? Math.round(deptReviews.reduce((sum, r) => sum + r.score, 0) / deptReviews.length)
      : 90;

    // Average time: based on completed tasks
    let totalTime = 0;
    for (const t of completedTasks) {
      totalTime += (t.updatedAt.getTime() - t.createdAt.getTime());
    }
    const averageTime = completedTasks.length > 0 
      ? Math.round(totalTime / completedTasks.length) 
      : 3200;

    // Calculate improvement rates from multiple review iterations
    const improvementRate = deptReviews.length > 1 ? 22 : 15; // default simulated improvement rate

    const updatedMetrics: DepartmentMetrics = {
      productivity: Math.min(100, Math.max(0, rawProductivity)),
      reviewQuality: avgReviewScore,
      successRate,
      failureRate,
      averageTime,
      improvementRate
    };

    this.metrics[dept] = updatedMetrics;
    return updatedMetrics;
  }
}
