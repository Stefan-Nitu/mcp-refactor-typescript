import type { RefactorResult, TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';

export class TSServerGuard {
  constructor(private tsServer: TypeScriptServer) {}

  async ensureReady(): Promise<RefactorResult | null> {
    if (!this.tsServer.isRunning()) {
      await this.tsServer.start(process.cwd());
    }

    const loadingResult = await this.tsServer.checkProjectLoaded();
    if (loadingResult) return loadingResult;

    return null;
  }
}
