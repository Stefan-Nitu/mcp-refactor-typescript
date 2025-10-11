/**
 * Telemetry logging for tool usage tracking
 * Logs to stderr (safe for MCP protocol)
 */

import { logger } from './logger.js';
import { relative } from 'path';

export interface TelemetryEvent {
  event: 'tool_call' | 'tool_success' | 'tool_error';
  tool: string;
  operation?: string;
  timestamp: number;
  durationMs?: number;
  filesAffected?: number;
  errorType?: string;
}

export class Telemetry {
  private startTime: number | null = null;

  start() {
    this.startTime = Date.now();
  }

  logToolCall(tool: string, operation?: string) {
    const event: TelemetryEvent = {
      event: 'tool_call',
      tool,
      operation,
      timestamp: Date.now()
    };
    logger.info(event, 'Tool invoked');
  }

  logSuccess(tool: string, operation: string | undefined, filesAffected: number) {
    const durationMs = this.startTime ? Date.now() - this.startTime : undefined;
    const event: TelemetryEvent = {
      event: 'tool_success',
      tool,
      operation,
      timestamp: Date.now(),
      durationMs,
      filesAffected
    };
    logger.info(event, 'Tool completed successfully');
  }

  logError(tool: string, operation: string | undefined, error: Error) {
    const durationMs = this.startTime ? Date.now() - this.startTime : undefined;
    const event: TelemetryEvent = {
      event: 'tool_error',
      tool,
      operation,
      timestamp: Date.now(),
      durationMs,
      errorType: error.name
    };
    logger.error(event, 'Tool failed');
  }

  static sanitizePath(path: string): string {
    try {
      return relative(process.cwd(), path);
    } catch {
      return '[path]';
    }
  }
}
