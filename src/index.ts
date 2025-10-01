#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { handleTypeScript, typescriptInputSchema, TYPESCRIPT_TOOL_DESCRIPTION } from './tools/typescript/index.js';

const server = new McpServer({
  name: 'mcp-refactor',
  version: '0.1.0'
});

// Register TypeScript refactoring tool
server.registerTool(
  'typescript',
  {
    title: 'TypeScript Refactoring',
    description: TYPESCRIPT_TOOL_DESCRIPTION,
    inputSchema: typescriptInputSchema
  },
  async (args) => {
    return await handleTypeScript(args);
  }
);

// Future language tools can be added here:
// server.registerTool('python', { ... }, async (args) => { ... });
// server.registerTool('go', { ... }, async (args) => { ... });
// server.registerTool('rust', { ... }, async (args) => { ... });

async function main() {
  const transport = new StdioServerTransport();

  process.on('SIGINT', () => {
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    process.exit(0);
  });

  await server.connect(transport);
  console.error('[MCP Refactor] Server started');
}

main().catch(error => {
  console.error('[MCP Refactor] Fatal error:', error);
  process.exit(1);
});