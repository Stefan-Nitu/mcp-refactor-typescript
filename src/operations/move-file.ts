/**
 * Move file operation handler
 */

import { resolve } from 'path';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import { MoveFileHelper } from './move-file-helper.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const moveFileSchema = z.object({
  sourcePath: z.string().min(1, 'Source path cannot be empty'),
  destinationPath: z.string().min(1, 'Destination path cannot be empty'),
  preview: z.boolean().optional()
});

export class MoveFileOperation {
  private helper: MoveFileHelper;

  constructor(private tsServer: TypeScriptServer,
    private tsServerGuard: TSServerGuard = new TSServerGuard(tsServer)
  ) {
    this.helper = new MoveFileHelper(tsServer);
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = moveFileSchema.parse(input);
      const sourcePath = resolve(validated.sourcePath);
      const destinationPath = resolve(validated.destinationPath);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(sourcePath);

      try {
        await this.tsServer.discoverAndOpenImportingFiles(sourcePath);
      } catch {
        // Continue if file references discovery fails
      }

      const projectFullyLoaded = this.tsServer.isProjectLoaded();
      const scanTimedOut = this.tsServer.didLastScanTimeout();
      const result = await this.helper.performMove(sourcePath, destinationPath, validated.preview);

      let warningMessage = '';
      if (!projectFullyLoaded) {
        warningMessage += '\n\nWarning: TypeScript is still indexing the project. Some import updates may have been missed.';
      }
      if (scanTimedOut) {
        warningMessage += '\n\nWarning: File discovery timed out. Some files may not have been scanned. Import updates might be incomplete.';
      }
      if (warningMessage) {
        warningMessage += ' If results seem incomplete, try running the operation again.';
      }

      return {
        ...result,
        message: result.message + warningMessage
      };
    } catch (error) {
      return {
        success: false,
        message: `Move file failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure source file exists and destination path is valid
  2. Check that destination directory is writable
  3. Verify no other file exists at destination path`,
        filesChanged: [],
      };
    }
  }

  async performMove(sourcePath: string, destinationPath: string, preview?: boolean): Promise<RefactorResult> {
    return await this.helper.performMove(sourcePath, destinationPath, preview);
  }

}
