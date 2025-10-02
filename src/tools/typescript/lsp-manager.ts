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

    console.error('[LSP Manager] TypeScript server initialized, monitoring project loading...');

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