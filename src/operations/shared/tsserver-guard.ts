import type { RefactorResult, TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';

export class TSServerGuard {
  constructor(private tsServer: TypeScriptServer) {}

  async ensureReady(timeout = 5000): Promise<RefactorResult | null> {
    if (!this.tsServer.isRunning()) {
      await this.tsServer.start(process.cwd());
    }

    return await this.checkProjectLoaded(timeout);
  }

  private async checkProjectLoaded(timeout = 5000): Promise<RefactorResult | null> {
    if (this.tsServer.isProjectLoaded()) return null;

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (this.tsServer.isProjectLoaded()) {
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      success: false,
      message: `⏳ TypeScript is still indexing the project (waited ${timeout}ms)

💡 Try:
  1. Wait a few more seconds and try again
  2. For large projects, indexing can take 10-30 seconds
  3. Check that tsconfig.json is properly configured`,
      filesChanged: []
    };
  }
}
