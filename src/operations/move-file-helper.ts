/**
 * Helper for performing file moves with TypeScript import updates
 */

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSFileEdit, TSTextChange } from '../language-servers/typescript/tsserver-types.js';

export class MoveFileHelper {
  constructor(private tsServer: TypeScriptServer) {}

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
      const fileContent = await readFile(fileEdit.fileName, 'utf8');
      const lines = fileContent.split('\n');

      const fileChanges = {
        file: fileEdit.fileName.split('/').pop() || fileEdit.fileName,
        path: fileEdit.fileName,
        edits: [] as RefactorResult['filesChanged'][0]['edits']
      };

      const sortedChanges = [...fileEdit.textChanges].sort((a: TSTextChange, b: TSTextChange) => {
        if (b.start.line !== a.start.line) return b.start.line - a.start.line;
        return b.start.offset - a.start.offset;
      });

      for (const change of sortedChanges) {
        const startLine = change.start.line - 1;
        const endLine = change.end.line - 1;
        const startOffset = change.start.offset - 1;
        const endOffset = change.end.offset - 1;

        fileChanges.edits.push({
          line: change.start.line,
          old: lines[startLine].substring(startOffset, endOffset),
          new: change.newText
        });

        if (startLine === endLine) {
          lines[startLine] =
            lines[startLine].substring(0, startOffset) +
            change.newText +
            lines[startLine].substring(endOffset);
        } else {
          const before = lines[startLine].substring(0, startOffset);
          const after = lines[endLine].substring(endOffset);
          lines.splice(startLine, endLine - startLine + 1, before + change.newText + after);
        }
      }

      const updatedContent = lines.join('\n');

      if (!preview) {
        await writeFile(fileEdit.fileName, updatedContent);
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
