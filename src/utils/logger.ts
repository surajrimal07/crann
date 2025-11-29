export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static debug = false;
  private static prefix = 'CrannLogger';
  private static noOp = function () {};

  private context: string;
  private tag: string | null = null;

  /**
   * Create a new Logger instance with a specific context
   */
  constructor(context: string) {
    this.context = context;
  }

  static setDebug(value: boolean): void {
    Logger.debug = value;
  }

  static setPrefix(value: string): void {
    Logger.prefix = value;
  }

  /**
   * Set a persistent tag for this Logger instance
   */
  setTag(tag: string | null): void {
    this.tag = tag;
  }

  /**
   * Create a temporary logger with a specific tag
   * This doesn't modify the original logger instance
   */
  withTag(tag: string) {
    const tempLogger = new Logger(this.context);
    tempLogger.setTag(tag);
    return tempLogger;
  }

  /**
   * Get the full context string including tag if present
   */
  private getFullContext(): string {
    if (this.tag) {
      return `${this.context}:${this.tag}`;
    }
    return this.context;
  }

  /**
   * Create the log methods bound to the current context and tag
   */
  private createLogMethods() {
    const fullContext = this.getFullContext();
    const formatString = `%c${Logger.prefix}%c [%c${fullContext}%c]`;

    // Styles for the prefix and context - updated for better readability on dark backgrounds
    const prefixStyle = 'color: #3fcbff; font-weight: bold'; // Bright cyan
    const contextStyle = 'color: #d58cff; font-weight: bold'; // Bright purple
    const resetStyle = '';

    if (Logger.debug) {
      return {
        debug: console.log.bind(
          console,
          formatString,
          prefixStyle,
          resetStyle,
          contextStyle,
          resetStyle
        ),
        log: console.log.bind(
          console,
          formatString,
          prefixStyle,
          resetStyle,
          contextStyle,
          resetStyle
        ),
        info: console.info.bind(
          console,
          formatString,
          prefixStyle,
          resetStyle,
          contextStyle,
          resetStyle
        ),
        warn: console.warn.bind(
          console,
          formatString,
          prefixStyle,
          resetStyle,
          contextStyle,
          resetStyle
        ),
        error: console.error.bind(
          console,
          formatString,
          prefixStyle,
          resetStyle,
          contextStyle,
          resetStyle
        ),
      };
    } else {
      return {
        debug: Logger.noOp,
        log: Logger.noOp,
        info: Logger.noOp,
        warn: Logger.noOp,
        error: Logger.noOp,
      };
    }
  }

  /**
   * Log methods that are dynamically created based on current context and tag
   */
  get debug() {
    return this.createLogMethods().debug;
  }
  get log() {
    return this.createLogMethods().log;
  }
  get info() {
    return this.createLogMethods().info;
  }
  get warn() {
    return this.createLogMethods().warn;
  }
  get error() {
    return this.createLogMethods().error;
  }

  /**
   * Static helper to create a logger with a specific context
   */
  static forContext(context: string, tag?: string): Logger {
    const logger = new Logger(context);
    if (tag) {
      logger.setTag(tag);
    }
    return logger;
  }
}
