import { Request, Response, NextFunction } from "express";
import { Logger } from "../../infrastructure/logging/Logger";
import { MetricsCollector } from "../../infrastructure/observability/MetricsCollector";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errorName = err.name || "Error";
  const errorMessage = err.message || "An unexpected error occurred";
  
  MetricsCollector.getInstance().recordError(errorName, errorMessage, `Route: ${req.method} ${req.path}`);
  
  const logCtx = {
    method: req.method,
    path: req.path,
    errorName,
    message: errorMessage
  };

  // Log structured details
  Logger.error(`API execution error on ${req.method} ${req.path}`, err, logCtx);

  // Translate Domain Errors to proper HTTP Status Codes
  let status = 500;
  let code = "INTERNAL_SERVER_ERROR";

  if (
    errorName === "InvalidStateTransitionError" ||
    errorName === "DomainInvariantViolationError" ||
    errorName === "CircularDependencyError"
  ) {
    status = 400;
    code = "BAD_REQUEST_DOMAIN_VIOLATION";
  } else if (errorName === "UnauthorizedActionError") {
    status = 403;
    code = "FORBIDDEN_ACTION";
  } else if (errorMessage.toLowerCase().includes("not found")) {
    status = 404;
    code = "NOT_FOUND";
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      type: errorName,
      message: errorMessage,
      timestamp: new Date().toISOString()
    }
  });
}
