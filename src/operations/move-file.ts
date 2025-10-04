/**
 * Move file operation handler
 */

import { z } from 'zod';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import type { TSTextChange, TSFileEdit } from '../language-servers/typescript/tsserver-types.js';

export const moveFileSchema = z.object({
  sourcePath: z.string().min(1, 'Source path cannot be empty'),
  destinationPath: z.string().min(1, 'Destination path cannot be empty'),
  preview: z.boolean().optional()
});

export type MoveFileInput = z.infer<typeof moveFileSchema>;

export class MoveFileOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = moveFileSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      const edits = await this.tsServer.sendRequest<TSFileEdit[]>('getEditsForFileRename', {
        oldFilePath: validated.sourcePath,
        newFilePath: validated.destinationPath
      });

      if (!edits || edits.length === 0) {
        // No import updates needed, just move the file
        if (validated.preview) {
          return {
            success: true,
            message: `Preview: Would move file (no import updates needed)`,
            filesChanged: [],
            changes: [],
            preview: {
              filesAffected: 1,
              estimatedTime: '< 1s',
              command: 'Run again with preview: false to apply changes'
            }
          };
        }

        await this.ensureDirectoryExists(validated.destinationPath);
        await rename(validated.sourcePath, validated.destinationPath);

        return {
          success: true,
          message: 'File moved (no import updates needed)',
          filesChanged: [],
          changes: [],
          nextActions: [
            'find_references - Verify no references were missed'
          ]
        };
      }

      const filesChanged: string[] = [];
      const changes: RefactorResult['changes'] = [];

      // Apply edits to each affected file
      for (const fileEdit of edits) {
        const fileContent = await readFile(fileEdit.fileName, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileEdit.fileName.split('/').pop() || fileEdit.fileName,
          path: fileEdit.fileName,
          edits: [] as RefactorResult['changes'][0]['edits']
        };

        // Apply text changes in reverse order
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

        // Only write if not in preview mode
        if (!validated.preview) {
          await writeFile(fileEdit.fileName, updatedContent);
        }
        filesChanged.push(fileEdit.fileName);
        changes.push(fileChanges);
      }

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would move file and update ${filesChanged.length} import(s)`,
          filesChanged,
          changes,
          preview: {
            filesAffected: filesChanged.length + 1, // +1 for the moved file itself
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      // Actually move the file
      await this.ensureDirectoryExists(validated.destinationPath);
      await rename(validated.sourcePath, validated.destinationPath);

      return {
        success: true,
        message: `Moved file and updated ${filesChanged.length} import(s)`,
        filesChanged,
        changes,
        nextActions: [
          'organize_imports - Clean up import statements',
          'fix_all - Fix any errors from the move'
        ]
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Move file failed: ${error instanceof Error ? error.message : String(error)}

💡 Try:
  1. Ensure source file exists and destination path is valid
  2. Check that destination directory is writable
  3. Verify no other file exists at destination path`,
        filesChanged: [],
        changes: []
      };
    }
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
  }

  getSchema() {
    return {
      title: 'Move File',
      description: `⚡ Move file + auto-update ALL import paths across entire codebase. Zero manual import fixing. Handles ES6 imports, CommonJS requires, dynamic imports, re-exports, and type-only imports. Completes in <2s vs 15-30min manually updating imports across dozens of files.

Example: Move src/utils.ts → src/helpers/utils.ts
  Input:
    main.ts: import { helper } from './utils.js';
  ✓ Moves the file
  ✓ Updates import in main.ts:
    import { helper } from './utils.js' → './helpers/utils.js'
  ✓ Updates all other files that import it
  ✓ Handles ES6, CommonJS, dynamic imports`,
      inputSchema: moveFileSchema.shape
    };
  }
}