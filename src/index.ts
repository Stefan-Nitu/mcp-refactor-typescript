#!/usr/bin/env node

/**
 * MCP Server for code refactoring
 * Entry point - delegates operations to specialized handlers
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OperationRegistry } from './registry.js';
import { operationsCatalog } from './resources/operations-catalog.js';
import { groupedTools } from './tools/grouped-tools.js';
import { toolInputShape } from './tools/tool-input-shape.js';
import { flushLogs, logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8'),
);

const server = new McpServer(
  {
    name: 'mcp-refactor-typescript',
    version: packageJson.version,
  },
  {
    // Clients that defer tool definitions, such as Claude Code and Codex, show
    // the model only tool names, so this is what tells it when to look for them
    instructions: `Refactors TypeScript and JavaScript through the TypeScript language service, updating every import and reference that mv, sed or a text edit would leave broken. Use these tools instead of editing by hand whenever you:
- rename or move a .ts/.tsx/.js/.jsx file: file_operations
- rename a symbol, extract a function, constant or variable, or move a declaration to another file: refactoring
- organize imports, fix TypeScript errors or remove unused code: code_quality
- list every reference to a symbol before changing it: workspace (find_references)
Every path must be absolute. Pass preview: true to see the edits without applying them. workspace's cleanup_codebase with deleteUnusedFiles: true deletes files.
Every operation, with examples: the operations://catalog resource.`,
  },
);

const registry = new OperationRegistry();

// Register operations catalog as MCP resource
server.registerResource(
  'operations-catalog',
  'operations://catalog',
  {
    title: 'Operations Catalog',
    description:
      'Detailed documentation for all refactoring operations with examples',
    mimeType: 'text/markdown',
  },
  async () => ({
    contents: [
      {
        uri: 'operations://catalog',
        mimeType: 'text/markdown',
        text: operationsCatalog,
      },
    ],
  }),
);

/**
 * `isError` is what an MCP client reads to tell a failed call from a
 * successful one - the `status` field inside the JSON body never reaches it,
 * so without this every failure was indistinguishable from success.
 */
function toolResponse(response: Record<string, unknown>, failed: boolean) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
    isError: failed,
  };
}

// Register grouped tools (v2.0)
for (const tool of groupedTools) {
  const schema = toolInputShape(tool.inputSchema);

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: schema,
      annotations: tool.annotations,
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await tool.execute(args, registry);

        return toolResponse(
          {
            tool: tool.name,
            operation: args.operation,
            status: result.success ? 'success' : 'error',
            message: result.message,
            data: {
              filesChanged: result.filesChanged || [],
              // Operations fill both in; forwarding them is what lets a
              // client act on a preview or on the suggested follow-up
              ...(result.preview && { preview: result.preview }),
              ...(result.nextActions && { nextActions: result.nextActions }),
            },
          },
          !result.success,
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          return toolResponse(
            {
              tool: tool.name,
              operation: args.operation,
              status: 'error',
              message: 'Invalid input',
              errors: error.issues.map((e) => ({
                path: e.path.join('.'),
                message: e.message,
              })),
            },
            true,
          );
        }

        return toolResponse(
          {
            tool: tool.name,
            operation: args.operation,
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
          true,
        );
      }
    },
  );
}

async function main() {
  await registry.initialize();

  const transport = new StdioServerTransport();

  let cleanupStarted = false;

  const cleanup = async () => {
    if (cleanupStarted) {
      logger.info('Cleanup already started, skipping');
      return;
    }
    cleanupStarted = true;

    logger.info('Shutting down...');
    flushLogs();

    const timeoutId = setTimeout(() => {
      logger.error('Cleanup timeout - forcing exit after 5 seconds');
      flushLogs();
      process.exit(1);
    }, 5000);

    try {
      await server.close();
      await registry.close();

      clearTimeout(timeoutId);
      logger.info('Cleanup completed successfully');
      process.exit(0);
    } catch (error) {
      clearTimeout(timeoutId);
      logger.error({ err: error }, 'Error during cleanup');
      flushLogs();
      process.exit(1);
    }
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  await server.connect(transport);

  process.stdin.once('end', cleanup);
  process.stdin.once('close', cleanup);

  logger.info('Server started with tsserver (TypeScript/JavaScript support)');
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
