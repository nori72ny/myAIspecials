export interface ExecutionResult<T = any> {
  status: "SUCCESS" | "FAILURE";
  data?: T;
  error?: Error;
  durationMs: number;
}
