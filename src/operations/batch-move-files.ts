/**
 * Batch move files operation handler
 */

import { mkdir } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { z } from 'zod';
import { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import { FileDiscovery } from './shared/file-discovery.js';
import { FileMover } from './shared/file-mover.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const batchMoveFilesSchema = z.object({
  files: z.array(z.string().min(1)).min(1, 'At least one file must be provided'),
  targetFolder: z.string().min(1, 'Target folder cannot be empty'),
  preview: z.boolean().optional()
});

export class BatchMoveFilesOperation {
  constructor(
    private guard: TSServerGuard,
    private discovery: FileDiscovery,
    private helper: FileMover
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchMoveFilesSchema.parse(input);
      const files = validated.files.map(f => resolve(f));
      const targetFolder = resolve(validated.targetFolder);

      const guardResult = await this.guard.ensureReady();
      if (guardResult) return guardResult;

      await mkdir(targetFolder, { recursive: true });

      const projectStatus = await this.discovery.discoverRelatedFiles(files);

      const allFilesChanged: RefactorResult['filesChanged'] = [];
      let successCount = 0;
      const errors: string[] = [];

      for (const sourceFile of files) {
        const fileName = basename(sourceFile);
        const destinationPath = join(targetFolder, fileName);

        try {
          const result = await this.helper.performMove(sourceFile, destinationPath, validated.preview);

          if (result.success) {
            successCount++;
            if (result.filesChanged) {
              for (const fileChange of result.filesChanged) {
                const existingFile = allFilesChanged.find(f => f.path === fileChange.path);
                if (existingFile) {
                  existingFile.edits.push(...fileChange.edits);
                } else {
                  allFilesChanged.push(fileChange);
                }
              }
            }
          } else {
            errors.push(`${fileName}: ${result.message}`);
          }
        } catch (error) {
          errors.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (errors.length > 0 && successCount === 0) {
        return {
          success: false,
          message: `Failed to move all files:
${errors.join('\n')}

Try:
  1. Check that all source files exist
  2. Ensure target folder is writable
  3. Verify no filename conflicts in destination`,
          filesChanged: [],
        };
      }

      const warningMessage = this.discovery.buildWarningMessage(projectStatus, 'import updates');

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would move ${successCount} file(s) to ${basename(validated.targetFolder)}${warningMessage}`,
          filesChanged: allFilesChanged,
          preview: {
            filesAffected: successCount,
            estimatedTime: '< 2s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      const message = errors.length > 0
        ? `Moved ${successCount} file(s), ${errors.length} failed:\n${errors.join('\n')}`
        : `Moved ${successCount} file(s) to ${basename(validated.targetFolder)}`;

      return {
        success: true,
        message: message + warningMessage,
        filesChanged: allFilesChanged,
        nextActions: [
          'organize_imports - Clean up all import statements',
          'fix_all - Fix any errors from the moves'
        ]
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }
      return {
        success: false,
        message: `Batch move files failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure all source files exist
  2. Check that target folder path is valid
  3. Verify you have write permissions`,
        filesChanged: [],
      };
    }
  }
}
