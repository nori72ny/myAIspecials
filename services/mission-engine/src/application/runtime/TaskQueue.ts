import { Logger } from "../../infrastructure/logging/Logger";

export type QueueJob = () => Promise<any>;

export class TaskQueue {
  private queue: QueueJob[] = [];
  private isProcessing: boolean = false;

  public enqueue(job: QueueJob): Promise<any> {
    return new Promise((resolve, reject) => {
      const wrappedJob = async () => {
        try {
          const res = await job();
          resolve(res);
        } catch (e) {
          reject(e);
        }
      };

      this.queue.push(wrappedJob);
      Logger.debug(`Job enqueued. Current queue size: ${this.queue.length}`);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const currentJob = this.queue.shift()!;

    try {
      await currentJob();
    } catch (e) {
      Logger.error(`Error executing enqueued task job`, e);
    } finally {
      this.isProcessing = false;
      // Yield to let other tasks in the microtask queue run before taking the next job
      setTimeout(() => this.processNext(), 0);
    }
  }

  public get size(): number {
    return this.queue.length;
  }
}
