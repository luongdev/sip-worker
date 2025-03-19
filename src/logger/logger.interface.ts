export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogMessage {
  level: LogLevel;
  context: string;
  message: string;
  timestamp: number;
  data?: any;
}

export interface LoggerOptions {
  context: string;
  minLevel?: LogLevel;
  enabled?: boolean;
}

export interface ILogger {
  debug(message: string, data?: any): LogMessage | undefined;
  info(message: string, data?: any): LogMessage | undefined;
  warn(message: string, data?: any): LogMessage | undefined;
  error(message: string, data?: any): LogMessage | undefined;
}
