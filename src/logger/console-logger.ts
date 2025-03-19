import { AbstractLogger } from "./abstract-logger";
import { LogMessage } from "./logger.interface";

export class ConsoleLogger extends AbstractLogger {
  protected output(log: LogMessage): void {
    const timestamp = new Date(log.timestamp).toISOString();
    const prefix = `[${timestamp}] [${log.level}] [${log.context}]`;

    switch (log.level) {
      case 0: // DEBUG
        console.debug(`${prefix} ${log.message}`, log.data);
        break;
      case 1: // INFO
        console.info(`${prefix} ${log.message}`, log.data);
        break;
      case 2: // WARN
        console.warn(`${prefix} ${log.message}`, log.data);
        break;
      case 3: // ERROR
        console.error(`${prefix} ${log.message}`, log.data);
        break;
      default:
        console.log(`${prefix} ${log.message}`, log.data);
    }
  }
}
