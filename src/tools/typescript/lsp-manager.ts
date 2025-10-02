import { TypeScriptLanguageServer } from './lsp-server.js';

let server: TypeScriptLanguageServer | null = null;

export async function getLanguageServer(): Promise<TypeScriptLanguageServer> {
  // Check if server exists and is still connected
  if (server) {
    try {
      // Test if connection is still alive
      const testConnection = await server.isConnected();
      if (!testConnection) {
        console.error('[LSP Manager] Connection lost, restarting server...');
        await server.shutdown().catch(() => {}); // Ignore shutdown errors
        server = null;
      }
    } catch (error) {
      console.error('[LSP Manager] Connection check failed, restarting server...');
      server = null;
    }
  }

  if (!server) {
    // Get project root from current working directory
    const projectRoot = process.cwd();
    server = new TypeScriptLanguageServer(projectRoot);
    await server.initialize();

    // TypeScript needs time to index the project for cross-file operations.
    // There's no reliable LSP notification for completion (projectLoadingFinish
    // is internal to tsserver, not exposed through typescript-language-server).
    //
    // Wait time scales with project size:
    // - Small projects (<50 files): 1-2 seconds
    // - Medium projects (50-500 files): 3-10 seconds
    // - Large projects (>500 files): up to 1-2 minutes
    //
    // For now, use a conservative 2-second default. Users can set LSP_INDEX_TIMEOUT_MS
    // environment variable for larger projects.
    const indexTimeout = parseInt(process.env.LSP_INDEX_TIMEOUT_MS || '2000', 10);
    await new Promise(resolve => setTimeout(resolve, indexTimeout));
    console.error(`[LSP Manager] Waited ${indexTimeout}ms for TypeScript indexing`);

    // Setup cleanup handlers
    process.on('SIGINT', async () => {
      if (server) {
        await server.shutdown();
        server = null;
      }
    });

    process.on('SIGTERM', async () => {
      if (server) {
        await server.shutdown();
        server = null;
      }
    });
  }

  return server;
}