/**
 * Batch move files operation handler
 */

import { mkdir } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import { logger } from '../utils/logger.js';
import { formatValidationError } from '../utils/validation-error.js';
import { MoveFileHelper } from './move-file-helper.js';

export const batchMoveFilesSchema = z.object({
  files: z.array(z.string().min(1)).min(1, 'At least one file must be provided'),
  targetFolder: z.string().min(1, 'Target folder cannot be empty'),
  preview: z.boolean().optional()
});

export class BatchMoveFilesOperation {
  private helper: MoveFileHelper;

  constructor(private tsServer: TypeScriptServer) {
    this.helper = new MoveFileHelper(tsServer);
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchMoveFilesSchema.parse(input);
      const files = validated.files.map(f => resolve(f));
      const targetFolder = resolve(validated.targetFolder);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await mkdir(targetFolder, { recursive: true });

      for (const sourceFile of files) {
        await this.tsServer.openFile(sourceFile);
      }

      try {
        await this.tsServer.discoverAndOpenImportingFiles(files);
      } catch (error) {
        logger.debug({ error }, 'Error discovering importing files');
      }

      const projectFullyLoaded = this.tsServer.isProjectLoaded();
      const scanTimedOut = this.tsServer.didLastScanTimeout();

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
              // Add files that aren't already in the list (based on path)
              for (const fileChange of result.filesChanged) {
                if (!allFilesChanged.find(f => f.path === fileChange.path)) {
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
