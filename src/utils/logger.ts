/**
 * Logger utility using Pino
 * Configured to write to stderr for MCP protocol compliance
 */

import pino from 'pino';

const destination = pino.destination({ dest: 2, sync: false });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
  },
  destination
);

export function flushLogs(): void {
  destination.flushSync();
}
