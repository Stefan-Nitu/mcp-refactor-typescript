/**
 * Helper for performing file moves with TypeScript import updates
 */

import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  RefactorResult,
  TypeScriptServer,
} from '../../language-servers/typescript/tsserver-client.js';
import type { TSFileEdit } from '../../language-servers/typescript/tsserver-types.js';
import { logger } from '../../utils/logger.js';
import { EditApplicator } from './edit-applicator.js';
import { FileOperations } from './file-operations.js';
import { StringLiteralPathUpdater } from './string-literal-path-updater.js';

export class FileMover {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations = new FileOperations(),
    private editApplicator: EditApplicator = new EditApplicator(),
    private mockUpdater: StringLiteralPathUpdater = new StringLiteralPathUpdater(),
  ) {}

  async performMove(
    sourcePath: string,
    destinationPath: string,
    preview?: boolean,
  ): Promise<RefactorResult> {
    const edits = await this.tsServer.sendRequest<TSFileEdit[]>(
      'getEditsForFileRename',
      {
        oldFilePath: sourcePath,
        newFilePath: destinationPath,
      },
    );

    if (!edits || edits.length === 0) {
      if (preview) {
        return {
          success: true,
          message: `Preview: Would move file (no import updates needed)`,
          filesChanged: [],
          preview: {
            filesAffected: 1,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes',
          },
        };
      }

      await this.ensureDirectoryExists(destinationPath);
      await rename(sourcePath, destinationPath);
      await this.syncMovedFile(sourcePath, destinationPath, []);

      return {
        success: true,
        message: 'File moved (no import updates needed)',
        filesChanged: [],
        nextActions: ['find_references - Verify no references were missed'],
      };
    }

    const filesChanged: RefactorResult['filesChanged'] = [];
    const processedFiles = new Set<string>();

    for (const fileEdit of edits) {
      const originalLines = await this.fileOps.readLines(fileEdit.fileName);
      const fileContent = originalLines.join('\n');

      const mockUpdates = this.mockUpdater.findMockPathUpdates(
        fileContent,
        fileEdit.fileName,
        sourcePath,
        destinationPath,
      );

      const allTextChanges = [...fileEdit.textChanges];
      for (const mockUpdate of mockUpdates) {
        const start = {
          line: mockUpdate.line,
          offset: mockUpdate.column,
        };
        const end = {
          line: mockUpdate.line,
          offset: mockUpdate.column + mockUpdate.old.length,
        };

        allTextChanges.push({
          start,
          end,
          newText: mockUpdate.new,
        });
      }

      const sortedChanges = this.editApplicator.sortEdits(allTextChanges);
      const fileChanges = this.editApplicator.buildFileChanges(
        originalLines,
        sortedChanges,
        fileEdit.fileName,
      );
      const updatedLines = this.editApplicator.applyEdits(
        originalLines,
        sortedChanges,
      );

      if (!preview) {
        await this.fileOps.writeLines(fileEdit.fileName, updatedLines);
      }

      filesChanged.push(fileChanges);
      processedFiles.add(fileEdit.fileName);
    }

    if (preview) {
      return {
        success: true,
        message: `Preview: Would move file and update ${filesChanged.length} import(s)`,
        filesChanged,
        preview: {
          filesAffected: filesChanged.length + 1,
          estimatedTime: '< 1s',
          command: 'Run again with preview: false to apply changes',
        },
      };
    }

    await this.ensureDirectoryExists(destinationPath);
    await rename(sourcePath, destinationPath);
    await this.syncMovedFile(sourcePath, destinationPath, edits);

    return {
      success: true,
      message: `Moved file and updated ${filesChanged.length} import(s)`,
      filesChanged,
      nextActions: [
        'organize_imports - Clean up import statements',
        'fix_all - Fix any errors from the move',
      ],
    };
  }

  /**
   * tsserver still serves the in-memory copy opened during discovery, so it has
   * to be told the file left its old path - otherwise the next file in a batch
   * is computed against a project where this move never happened. Best effort:
   * the move is already on disk, a stale server view must not fail it.
   */
  private async syncMovedFile(
    sourcePath: string,
    destinationPath: string,
    edits: TSFileEdit[],
  ): Promise<void> {
    try {
      await this.tsServer.closeFile(sourcePath);
      await this.tsServer.openFile(destinationPath);

      for (const fileEdit of edits) {
        if (fileEdit.fileName === sourcePath) continue;
        await this.tsServer.reloadFile(fileEdit.fileName);
      }
    } catch (error) {
      logger.debug(
        { sourcePath, destinationPath, error },
        'Failed to sync moved file in tsserver',
      );
    }
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
  }
}
