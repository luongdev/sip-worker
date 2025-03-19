import { ILogger, LoggerOptions } from "./logger.interface";
import { ConsoleLogger } from "./console-logger";

export class LoggerFactory {
  private static instance: LoggerFactory;
  private loggers: Map<string, ILogger> = new Map();

  private constructor() {}

  static getInstance(): LoggerFactory {
    if (!LoggerFactory.instance) {
      LoggerFactory.instance = new LoggerFactory();
    }
    return LoggerFactory.instance;
  }

  getLogger(context: string, options: Partial<LoggerOptions> = {}): ILogger {
    if (!this.loggers.has(context)) {
      this.loggers.set(
        context,
        new ConsoleLogger({
          context,
          ...options,
        })
      );
    }
    return this.loggers.get(context)!;
  }

  setLogger(context: string, logger: ILogger): void {
    this.loggers.set(context, logger);
  }
}
