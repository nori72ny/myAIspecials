export class TimeoutError extends Error {
  constructor(message: string = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string = "Operation"): Promise<T> {
  let timer: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${context} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.then(result => {
      clearTimeout(timer);
      return result;
    }),
    timeoutPromise
  ]);
}
