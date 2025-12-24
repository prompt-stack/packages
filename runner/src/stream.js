/**
 * Log streaming for stack execution
 */

import { EventEmitter } from 'events';

/**
 * Log stream for capturing and routing execution output
 */
export class LogStream extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.startTime = Date.now();
  }

  /**
   * Write a log entry
   * @param {'stdout' | 'stderr' | 'info' | 'error'} type
   * @param {string} message
   */
  write(type, message) {
    const entry = {
      type,
      message,
      timestamp: Date.now() - this.startTime
    };

    this.logs.push(entry);
    this.emit('log', entry);
    this.emit(type, message);
  }

  /**
   * Write stdout
   */
  stdout(message) {
    this.write('stdout', message);
  }

  /**
   * Write stderr
   */
  stderr(message) {
    this.write('stderr', message);
  }

  /**
   * Write info message
   */
  info(message) {
    this.write('info', message);
  }

  /**
   * Write error message
   */
  error(message) {
    this.write('error', message);
  }

  /**
   * Get all logs
   * @returns {Array}
   */
  getLogs() {
    return this.logs;
  }

  /**
   * Get logs as string
   * @param {'all' | 'stdout' | 'stderr'} filter
   * @returns {string}
   */
  toString(filter = 'all') {
    return this.logs
      .filter(log => filter === 'all' || log.type === filter)
      .map(log => log.message)
      .join('');
  }

  /**
   * Clear logs
   */
  clear() {
    this.logs = [];
  }
}

/**
 * Create a log stream with callbacks
 * @param {Object} callbacks
 * @param {Function} [callbacks.onStdout]
 * @param {Function} [callbacks.onStderr]
 * @param {Function} [callbacks.onLog]
 * @returns {LogStream}
 */
export function createLogStream(callbacks = {}) {
  const stream = new LogStream();

  if (callbacks.onStdout) {
    stream.on('stdout', callbacks.onStdout);
  }

  if (callbacks.onStderr) {
    stream.on('stderr', callbacks.onStderr);
  }

  if (callbacks.onLog) {
    stream.on('log', callbacks.onLog);
  }

  return stream;
}

/**
 * Format log output for display
 * @param {Array} logs
 * @param {Object} options
 * @returns {string}
 */
export function formatLogs(logs, options = {}) {
  const { showTimestamp = false, colorize = true } = options;

  const colors = {
    stdout: '\x1b[0m',     // Default
    stderr: '\x1b[31m',    // Red
    info: '\x1b[36m',      // Cyan
    error: '\x1b[31m',     // Red
    reset: '\x1b[0m'
  };

  return logs.map(log => {
    let line = '';

    if (showTimestamp) {
      const ts = (log.timestamp / 1000).toFixed(2);
      line += `[${ts}s] `;
    }

    if (colorize) {
      line += colors[log.type] + log.message + colors.reset;
    } else {
      line += log.message;
    }

    return line;
  }).join('');
}

/**
 * Parse structured output from stack
 * Looks for JSON output markers
 * @param {string} output
 * @returns {{ text: string, structured: Object[] }}
 */
export function parseStructuredOutput(output) {
  const structured = [];
  let text = output;

  // Look for __PSTACK_OUTPUT__ markers
  const regex = /__PSTACK_OUTPUT__(.+?)__END_PSTACK_OUTPUT__/gs;
  let match;

  while ((match = regex.exec(output)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      structured.push(data);
      text = text.replace(match[0], '');
    } catch {
      // Not valid JSON, skip
    }
  }

  return { text: text.trim(), structured };
}

/**
 * Create a progress tracker
 * @param {Object} options
 * @param {number} options.total - Total steps
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Object}
 */
export function createProgressTracker(options = {}) {
  const { total = 100, onProgress } = options;

  let current = 0;
  let message = '';

  return {
    update(value, msg) {
      current = value;
      if (msg) message = msg;

      const progress = {
        current,
        total,
        percent: Math.round((current / total) * 100),
        message
      };

      onProgress?.(progress);
      return progress;
    },

    increment(amount = 1, msg) {
      return this.update(current + amount, msg);
    },

    complete(msg = 'Complete') {
      return this.update(total, msg);
    },

    get progress() {
      return {
        current,
        total,
        percent: Math.round((current / total) * 100),
        message
      };
    }
  };
}
