/**
 * Logging Utility
 * Centralized logging with prefixes
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

class Logger {
  log(prefix, message, ...args) {
    console.log(`[${prefix}] ${message}`, ...args);
  }

  success(prefix, message, ...args) {
    console.log(`${colors.green}[${prefix}] ✓ ${message}${colors.reset}`, ...args);
  }

  error(prefix, message, ...args) {
    console.error(`${colors.red}[${prefix}] ❌ ${message}${colors.reset}`, ...args);
  }

  warn(prefix, message, ...args) {
    console.warn(`${colors.yellow}[${prefix}] ⚠️  ${message}${colors.reset}`, ...args);
  }

  info(prefix, message, ...args) {
    console.log(`${colors.cyan}[${prefix}] ℹ ${message}${colors.reset}`, ...args);
  }

  debug(prefix, message, ...args) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${colors.magenta}[${prefix}] 🔍 ${message}${colors.reset}`, ...args);
    }
  }
}

export const logger = new Logger();






