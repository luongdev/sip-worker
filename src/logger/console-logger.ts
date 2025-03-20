import { AbstractLogger } from "./abstract-logger";
import { LogLevel, LogMessage } from "./logger.interface";

export class ConsoleLogger extends AbstractLogger {
  protected output(log: LogMessage): void {
    const timestamp = new Date(log.timestamp).toISOString();
    const prefix = `[${timestamp}] [${this.getLogLevel(log.level)}] [${
      log.context
    }]`;

    switch (log.level) {
      case 0: // DEBUG
        if (log.data) {
          console.debug(`${prefix} ${log.message}`, log.data);
        } else {
          console.debug(`${prefix} ${log.message}`);
        }
        break;
      case 1: // INFO
        if (log.data) {
          console.info(`${prefix} ${log.message}`, log.data);
        } else {
          console.info(`${prefix} ${log.message}`);
        }
        break;
      case 2: // WARN
        if (log.data) {
          console.warn(`${prefix} ${log.message}`, log.data);
        } else {
          console.warn(`${prefix} ${log.message}`);
        }
        break;
      case 3: // ERROR
        if (log.data) {
          console.error(`${prefix} ${log.message}`, log.data);
        } else {
          console.error(`${prefix} ${log.message}`);
        }
        break;
      default:
        if (log.data) {
          console.log(`${prefix} ${log.message}`, log.data);
        } else {
          console.log(`${prefix} ${log.message}`);
        }
    }
  }

  private getLogLevel(level: number): string {
    switch (level) {
      case LogLevel.DEBUG:
        return "DEBUG";
      case LogLevel.INFO:
        return "INFO";
      case LogLevel.WARN:
        return "WARN";
      case LogLevel.ERROR:
        return "ERROR";
      default:
        return "DEBUG";
    }
  }
}
