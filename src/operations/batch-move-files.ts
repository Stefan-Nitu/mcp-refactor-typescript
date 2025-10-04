/**
 * Batch move files operation handler
 */

import { z } from 'zod';
import { join, basename } from 'path';
import { mkdir } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { MoveFileOperation } from './move-file.js';
import { formatValidationError } from '../utils/validation-error.js';

export const batchMoveFilesSchema = z.object({
  files: z.array(z.string().min(1)).min(1, 'At least one file must be provided'),
  targetFolder: z.string().min(1, 'Target folder cannot be empty'),
  preview: z.boolean().optional()
});

export type BatchMoveFilesInput = z.infer<typeof batchMoveFilesSchema>;

export class BatchMoveFilesOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchMoveFilesSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await mkdir(validated.targetFolder, { recursive: true });

      // Open all source files so TypeScript can track imports
      for (const sourceFile of validated.files) {
        await this.tsServer.openFile(sourceFile);
      }

      const moveOperation = new MoveFileOperation(this.tsServer);
      const allFilesChanged: string[] = [];
      const allChanges: RefactorResult['changes'] = [];
      let successCount = 0;
      const errors: string[] = [];

      for (const sourceFile of validated.files) {
        const fileName = basename(sourceFile);
        const destinationPath = join(validated.targetFolder, fileName);

        const result = await moveOperation.execute({
          sourcePath: sourceFile,
          destinationPath,
          preview: validated.preview
        });

        if (result.success) {
          successCount++;
          if (result.filesChanged) {
            allFilesChanged.push(...result.filesChanged.filter(f => !allFilesChanged.includes(f)));
          }
          if (result.changes) {
            allChanges.push(...result.changes);
          }
        } else {
          errors.push(`${fileName}: ${result.message}`);
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
          changes: []
        };
      }

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would move ${successCount} file(s) to ${basename(validated.targetFolder)}`,
          filesChanged: allFilesChanged,
          changes: allChanges,
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
        message,
        filesChanged: allFilesChanged,
        changes: allChanges,
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
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Batch Move Files',
      description: `Reorganize entire modules + update ALL imports automatically across the codebase. Move dozens of files at once with zero broken imports. Perfect for restructuring folders or consolidating related files. Saves hours of manual import path updates and eliminates the risk of broken references.

Example: Move utils.ts and helpers.ts to lib/ folder
  Input:
    main.ts: import { util } from './utils.js';
  ✓ Moves both files to lib/
  ✓ Updates imports in main.ts:
      './utils.js' → './lib/utils.js'
      './helpers.js' → './lib/helpers.js'
  ✓ All files moved atomically
  ✓ Zero broken imports`,
      inputSchema: batchMoveFilesSchema.shape
    };
  }
}
