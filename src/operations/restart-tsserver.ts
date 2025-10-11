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
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to restart TypeScript server: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }

}
