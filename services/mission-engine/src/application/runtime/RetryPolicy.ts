import { Logger } from "../../infrastructure/logging/Logger";

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
}

export class RetryPolicy {
  constructor(private config: RetryConfig = { maxAttempts: 3, initialDelayMs: 200, backoffFactor: 2 }) {}

  public async execute<T>(fn: () => Promise<T>, contextDesc: string = "Operation"): Promise<T> {
    let attempt = 0;
    let delay = this.config.initialDelayMs;

    while (attempt < this.config.maxAttempts) {
      try {
        attempt++;
        return await fn();
      } catch (error) {
        if (attempt >= this.config.maxAttempts) {
          Logger.error(`Retry limit of ${this.config.maxAttempts} reached for: ${contextDesc}`, error);
          throw error;
        }

        Logger.warn(`Attempt ${attempt} failed for: ${contextDesc}. Retrying in ${delay}ms...`, {
          attempt,
          nextDelayMs: delay,
          errorMessage: (error as Error).message
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= this.config.backoffFactor;
      }
    }

    throw new Error(`Unexpected retry loop exit for ${contextDesc}`);
  }
}
