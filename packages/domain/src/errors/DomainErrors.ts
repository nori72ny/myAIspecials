export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string, reason?: string) {
    super(`Invalid state transition from ${from} to ${to}${reason ? `: ${reason}` : ''}`);
  }
}

export class DomainInvariantViolationError extends DomainError {
  constructor(invariantName: string, message: string) {
    super(`Invariant Violation [${invariantName}]: ${message}`);
  }
}

export class CircularDependencyError extends DomainError {
  constructor(message: string) {
    super(`Circular Dependency Error: ${message}`);
  }
}

export class UnauthorizedActionError extends DomainError {
  constructor(message: string) {
    super(`Unauthorized Action: ${message}`);
  }
}
