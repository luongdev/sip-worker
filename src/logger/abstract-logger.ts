import {
  ILogger,
  LogLevel,
  LogMessage,
  LoggerOptions,
} from "./logger.interface";

export abstract class AbstractLogger implements ILogger {
  protected context: string;
  protected minLevel: LogLevel;
  protected enabled: boolean;

  constructor(options: LoggerOptions) {
    this.context = options.context;
    this.minLevel = options.minLevel ?? LogLevel.DEBUG;
    this.enabled = options.enabled ?? true;
  }

  debug(message: string, data?: any): LogMessage | undefined {
    return this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any): LogMessage | undefined {
    return this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any): LogMessage | undefined {
    return this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: any): LogMessage | undefined {
    return this.log(LogLevel.ERROR, message, data);
  }

  protected log(
    level: LogLevel,
    message: string,
    data?: any
  ): LogMessage | undefined {
    if (!this.enabled || level < this.minLevel) {
      return undefined;
    }

    const logMessage: LogMessage = {
      level,
      context: this.context,
      message,
      timestamp: Date.now(),
      data,
    };

    this.output(logMessage);
    return logMessage;
  }

  protected abstract output(log: LogMessage): void;
}
