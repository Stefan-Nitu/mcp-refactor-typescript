/**
 * Batch move files operation handler
 */

import { z } from 'zod';
import { join, basename } from 'path';
import { mkdir } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { MoveFileOperation } from './move-file.js';

export const batchMoveFilesSchema = z.object({
  files: z.array(z.string()).min(1, 'At least one file must be provided'),
  targetFolder: z.string()
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
          destinationPath
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
          message: `Failed to move files:\n${errors.join('\n')}`,
          filesChanged: [],
          changes: []
        };
      }

      const message = errors.length > 0
        ? `Moved ${successCount} file(s), ${errors.length} failed:\n${errors.join('\n')}`
        : `Moved ${successCount} file(s) to ${basename(validated.targetFolder)}`;

      return {
        success: true,
        message,
        filesChanged: allFilesChanged,
        changes: allChanges
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          message: `Invalid input: ${error.errors.map(e => e.message).join(', ')}`,
          filesChanged: [],
          changes: []
        };
      }
      return {
        success: false,
        message: `Batch move files failed: ${error}`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Batch Move Files',
      description: 'Move multiple files to a target folder and update all imports',
      inputSchema: batchMoveFilesSchema.shape
    };
  }
}
