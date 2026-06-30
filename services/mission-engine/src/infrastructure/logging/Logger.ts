export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogContext {
  correlationId?: string;
  missionId?: string;
  taskId?: string;
  [key: string]: any;
}

export class Logger {
  private static serviceName = "mission-engine";

  private static formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const ctxString = context ? ` ${JSON.stringify(context)}` : "";
    return `[${timestamp}] [${level}] [${this.serviceName}] ${message}${ctxString}`;
  }

  public static debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== "production" || process.env.LOG_LEVEL === "DEBUG") {
      console.log(this.formatMessage("DEBUG", message, context));
    }
  }

  public static info(message: string, context?: LogContext): void {
    console.log(this.formatMessage("INFO", message, context));
  }

  public static warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage("WARN", message, context));
  }

  public static error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    const mergedContext = { ...context, error: errorDetails };
    console.error(this.formatMessage("ERROR", message, mergedContext));
  }
}
