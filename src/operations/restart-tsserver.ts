import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import { logger } from '../utils/logger.js';

export const restartTsServerSchema = z.object({});

export type RestartTsServerInput = z.infer<typeof restartTsServerSchema>;

export class RestartTsServerOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(_input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      logger.info('Restarting TypeScript server...');

      if (this.tsServer.isRunning()) {
        await this.tsServer.stop();
      }

      await this.tsServer.start(process.cwd());

      return {
        success: true,
        message: 'TypeScript server restarted successfully',
        filesChanged: [],
        changes: []
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to restart TypeScript server: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Restart TypeScript Server',
      description: `Restart the TypeScript server to refresh project state and re-index all files. Forces TypeScript to pick up configuration changes, new dependencies, or file system updates that may not have been detected automatically.

Useful when:
  ✓ tsconfig.json changes
  ✓ Dependencies are updated (npm install)
  ✓ Server becomes unresponsive or stale
  ✓ After large file system changes
  ✓ Need to clear cached type information

This forces a complete re-index of the entire project.`,
      inputSchema: restartTsServerSchema.shape
    };
  }
}
