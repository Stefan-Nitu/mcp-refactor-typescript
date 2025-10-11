/**
 * Helper for performing file moves with TypeScript import updates
 */

import { mkdir, rename } from 'fs/promises';
import { dirname } from 'path';
import type { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSFileEdit } from '../language-servers/typescript/tsserver-types.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';

export class MoveFileHelper {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations = new FileOperations(),
    private editApplicator: EditApplicator = new EditApplicator()
  ) {}

  async performMove(
    sourcePath: string,
    destinationPath: string,
    preview?: boolean
  ): Promise<RefactorResult> {
    const edits = await this.tsServer.sendRequest<TSFileEdit[]>('getEditsForFileRename', {
      oldFilePath: sourcePath,
      newFilePath: destinationPath
    });

    if (!edits || edits.length === 0) {
      if (preview) {
        return {
          success: true,
          message: `Preview: Would move file (no import updates needed)`,
          filesChanged: [],
          preview: {
            filesAffected: 1,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      await this.ensureDirectoryExists(destinationPath);
      await rename(sourcePath, destinationPath);

      return {
        success: true,
        message: 'File moved (no import updates needed)',
        filesChanged: [],
        nextActions: [
          'find_references - Verify no references were missed'
        ]
      };
    }

    const filesChanged: RefactorResult['filesChanged'] = [];

    for (const fileEdit of edits) {
      const originalLines = await this.fileOps.readLines(fileEdit.fileName);
      const sortedChanges = this.editApplicator.sortEdits(fileEdit.textChanges);
      const fileChanges = this.editApplicator.buildFileChanges(originalLines, sortedChanges, fileEdit.fileName);
      const updatedLines = this.editApplicator.applyEdits(originalLines, sortedChanges);

      if (!preview) {
        await this.fileOps.writeLines(fileEdit.fileName, updatedLines);
      }

      filesChanged.push(fileChanges);
    }

    if (preview) {
      return {
        success: true,
        message: `Preview: Would move file and update ${filesChanged.length} import(s)`,
        filesChanged,
        preview: {
          filesAffected: filesChanged.length + 1,
          estimatedTime: '< 1s',
          command: 'Run again with preview: false to apply changes'
        }
      };
    }

    await this.ensureDirectoryExists(destinationPath);
    await rename(sourcePath, destinationPath);

    return {
      success: true,
      message: `Moved file and updated ${filesChanged.length} import(s)`,
      filesChanged,
      nextActions: [
        'organize_imports - Clean up import statements',
        'fix_all - Fix any errors from the move'
      ]
    };
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
  }
}
