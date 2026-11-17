/**
 * Simple logger for Cloudflare Workers using standard console methods.
 * Provides info, error, warn, and debug levels.
 * Note: Log level filtering (e.g., showing only >= info in production)
 * typically happens in the log viewing system (like Cloudflare Dashboard),
 * not within the Worker runtime itself.
 */
const logger = {
  /**
   * Logs informational messages.
   * @param obj - The primary object or message to log.
   * @param msg - An optional descriptive message.
   */
  info: (obj: unknown, msg?: string) => {
    const prefix = '[INFO]';
    if (msg) {
      console.log(prefix, msg, obj);
    } else if (typeof obj === 'string') {
      console.log(prefix, obj);
    } else {
      console.log(prefix, obj);
    }
  },

  /**
   * Logs error messages. Handles Error objects structurally.
   * @param obj - The error object or primary data to log.
   * @param msg - An optional descriptive message.
   */
  error: (obj: unknown, msg?: string) => {
    const prefix = '[ERROR]';
    // Determine the primary message string
    const message = msg ?? (obj instanceof Error ? obj.message : 'Error occurred');

    if (obj instanceof Error) {
      // Log structured error details for better analysis
      console.error(prefix, message, {
        name: obj.name,
        message: obj.message,
        stack: obj.stack,
        // Include cause if available (supported in modern runtimes)
        cause: obj.cause,
      });
    } else if (msg) {
      console.error(prefix, msg, obj);
    } else if (typeof obj === 'string') {
      console.error(prefix, obj); // Log string directly if no separate object
    } else {
      console.error(prefix, message, obj); // Log object with generic message if needed
    }
  },

  /**
   * Logs warning messages.
   * @param obj - The primary object or message to log.
   * @param msg - An optional descriptive message.
   */
  warn: (obj: unknown, msg?: string) => {
    const prefix = '[WARN]';
    if (msg) {
      console.warn(prefix, msg, obj);
    } else if (typeof obj === 'string') {
      console.warn(prefix, obj);
    } else {
      console.warn(prefix, obj);
    }
  },

  /**
   * Logs debug messages. These might be filtered out by log viewers by default.
   * @param obj - The primary object or message to log.
   * @param msg - An optional descriptive message.
   */
  debug: (obj: unknown, msg?: string) => {
    const prefix = '[DEBUG]';
    if (msg) {
      console.debug(prefix, msg, obj);
    } else if (typeof obj === 'string') {
      console.debug(prefix, obj);
    } else {
      console.debug(prefix, obj);
    }
  },
};

export default logger;
