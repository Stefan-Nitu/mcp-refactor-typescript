#!/usr/bin/env node
/**
 * MCP Server for code refactoring
 * Entry point - delegates operations to specialized handlers
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OperationRegistry } from './operations/registry.js';
import { logger } from './utils/logger.js';

const server = new McpServer({
  name: 'mcp-refactor-typescript',
  version: '1.0.0'
});

const registry = new OperationRegistry();

// Register each operation as a separate MCP tool
for (const [name, operation] of registry.getAllOperations()) {
  const schema = operation.getSchema();
  server.registerTool(
    name,
    schema,
    async (args) => {
      try {
        const result = await operation.execute(args);

        const response = {
          tool: name,
          status: result.success ? 'success' : 'error',
          message: result.message,
          data: {
            filesChanged: result.filesChanged || [],
            changes: result.changes || []
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
            tool: name,
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
          tool: name,
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

  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await registry.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    await registry.shutdown();
    process.exit(0);
  });

  await server.connect(transport);
  logger.info('Server started with tsserver (TypeScript/JavaScript support)');
}

main().catch(error => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});