/**
 * Rename file operation handler (in-place rename)
 */

import { dirname, join, resolve } from 'path';
import { z } from 'zod';
import { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { FileDiscovery } from './shared/file-discovery.js';
import { FileMover } from './shared/file-mover.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

const renameFileSchema = z.object({
  sourcePath: z.string().min(1, 'Source path cannot be empty'),
  name: z.string().min(1, 'Name cannot be empty'),
  preview: z.boolean().optional()
});

export class RenameFileOperation {
  constructor(
    private guard: TSServerGuard,
    private discovery: FileDiscovery,
    private helper: FileMover
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = renameFileSchema.parse(input);
      const sourcePath = resolve(validated.sourcePath);
      const directory = dirname(sourcePath);
      const destinationPath = join(directory, validated.name);

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
        message: `Rename file failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure source file exists and new name is valid
  2. Check that no other file exists with the new name
  3. Verify the directory is writable`,
        filesChanged: [],
      };
    }
  }
}
