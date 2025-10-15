#!/usr/bin/env node
/**
 * MCP Server for code refactoring
 * Entry point - delegates operations to specialized handlers
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { OperationRegistry } from './registry.js';
import { operationsCatalog } from './resources/operations-catalog.js';
import { groupedTools } from './tools/grouped-tools.js';
import { flushLogs, logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const server = new McpServer({
  name: 'mcp-refactor-typescript',
  version: packageJson.version
});

const registry = new OperationRegistry();

// Register operations catalog as MCP resource
server.registerResource(
  'operations-catalog',
  'operations://catalog',
  {
    title: 'Operations Catalog',
    description: 'Detailed documentation for all refactoring operations with examples',
    mimeType: 'text/markdown'
  },
  async () => ({
    contents: [{
      uri: 'operations://catalog',
      mimeType: 'text/markdown',
      text: operationsCatalog
    }]
  })
);

// Register grouped tools (v2.0)
for (const tool of groupedTools) {
  const schema = 'shape' in tool.inputSchema
    ? tool.inputSchema.shape
    : tool.inputSchema._def.schema.shape;

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: schema,
      annotations: tool.annotations
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await tool.execute(args, registry);

        const response = {
          tool: tool.name,
          operation: args.operation,
          status: result.success ? 'success' : 'error',
          message: result.message,
          data: {
            filesChanged: result.filesChanged || []
          }
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
          }]
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          const response = {
            tool: tool.name,
            operation: args.operation,
            status: 'error',
            message: 'Invalid input',
            errors: error.errors.map(e => ({
              path: e.path.join('.'),
              message: e.message
            }))
          };
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(response, null, 2)
            }]
          };
        }

        const response = {
          tool: tool.name,
          operation: args.operation,
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
          }]
        };
      }
    }
  );
}

async function main() {
  await registry.initialize();

  const transport = new StdioServerTransport();
  const shutdownEmitter = new EventEmitter();

  const cleanup = async () => {
    logger.info('Shutting down...');
    flushLogs();

    const timeoutId = setTimeout(() => {
      logger.error('Cleanup timeout - forcing exit');
      process.exit(1);
    }, 5000);

    try {
      await server.close();
      await registry.close();
      clearTimeout(timeoutId);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during cleanup');
      clearTimeout(timeoutId);
      process.exit(1);
    }
  };

  const triggerShutdown = () => shutdownEmitter.emit('shutdown');

  shutdownEmitter.once('shutdown', cleanup);
  process.on('SIGINT', triggerShutdown);
  process.on('SIGTERM', triggerShutdown);
  process.stdin.on('end', triggerShutdown);
  process.stdin.on('close', triggerShutdown);

  await server.connect(transport);
  logger.info('Server started with tsserver (TypeScript/JavaScript support)');
}

main().catch(error => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});