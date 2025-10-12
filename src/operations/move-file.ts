/**
 * Move file operation handler
 */

import { resolve } from 'path';
import { z } from 'zod';
import { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { FileDiscovery } from './shared/file-discovery.js';
import { FileMover } from './shared/file-mover.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const moveFileSchema = z.object({
  sourcePath: z.string().min(1, 'Source path cannot be empty'),
  destinationPath: z.string().min(1, 'Destination path cannot be empty'),
  preview: z.boolean().optional()
});

export class MoveFileOperation {
  constructor(
    private guard: TSServerGuard,
    private discovery: FileDiscovery,
    private helper: FileMover
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = moveFileSchema.parse(input);
      const sourcePath = resolve(validated.sourcePath);
      const destinationPath = resolve(validated.destinationPath);

      const guardResult = await this.guard.ensureReady();
      if (guardResult) return guardResult;

      const projectStatus = await this.discovery.discoverRelatedFiles(sourcePath);
      const result = await this.helper.performMove(sourcePath, destinationPath, validated.preview);

      const warningMessage = this.discovery.buildWarningMessage(projectStatus, 'import updates');

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
