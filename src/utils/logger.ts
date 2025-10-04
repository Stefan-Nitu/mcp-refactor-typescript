/**
 * Logger utility using Pino
 * Configured to write to stderr for MCP protocol compliance
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino/file',
    options: {
      destination: 2 // stderr
    }
  }
});
