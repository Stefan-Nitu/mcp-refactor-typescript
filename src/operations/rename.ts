/**
 * Rename operation handler
 */

import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRenameLoc, TSRenameResponse } from '../language-servers/typescript/tsserver-types.js';

export const renameSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  column: z.number().int().positive('Column must be a positive integer'),
  newName: z.string().min(1, 'New name cannot be empty'),
  preview: z.boolean().optional()
});

export class RenameOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = renameSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(validated.filePath);

      await this.tsServer.discoverAndOpenImportingFiles(validated.filePath);

      const projectFullyLoaded = this.tsServer.isProjectLoaded();

      const renameInfo = await this.tsServer.sendRequest('rename', {
        file: validated.filePath,
        line: validated.line,
        offset: validated.column,
        findInComments: false,
        findInStrings: false
      }) as TSRenameResponse | null;

      if (!renameInfo?.locs) {
        return {
          success: false,
          message: `Cannot rename: No symbol found at ${validated.filePath}:${validated.line}:${validated.column}

Try:
  1. Check the cursor position is on a valid identifier
  2. Use find_references to verify the symbol exists
  3. Ensure the file is saved and TypeScript can analyze it`,
          filesChanged: [],
          changes: []
        };
      }

      const filesChanged: string[] = [];
      const changes: RefactorResult['changes'] = [];

      for (const fileLoc of renameInfo.locs) {
        const fileContent = await readFile(fileLoc.file, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileLoc.file.split('/').pop() || fileLoc.file,
          path: fileLoc.file,
          edits: [] as RefactorResult['changes'][0]['edits']
        };

        const edits = fileLoc.locs.sort((a: TSRenameLoc, b: TSRenameLoc) =>
          b.start.line === a.start.line ? b.start.offset - a.start.offset : b.start.line - a.start.line
        );

        for (const edit of edits) {
          const lineIndex = edit.start.line - 1;
          const line = lines[lineIndex];
          const oldText = line.substring(edit.start.offset - 1, edit.end.offset - 1);

          fileChanges.edits.push({
            line: edit.start.line,
            column: edit.start.offset,
            old: oldText,
            new: validated.newName
          });

          lines[lineIndex] =
            line.substring(0, edit.start.offset - 1) +
            validated.newName +
            line.substring(edit.end.offset - 1);
        }

        if (!validated.preview) {
          await writeFile(fileLoc.file, lines.join('\n'));
        }
        filesChanged.push(fileLoc.file);
        changes.push(fileChanges);
      }

      const warningMessage = !projectFullyLoaded
        ? '\n\nWarning: TypeScript is still indexing the project. Some references may have been missed. If results seem incomplete, wait a moment and try again.'
        : '';

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would rename to "${validated.newName}" in ${filesChanged.length} file(s)${warningMessage}`,
          filesChanged,
          changes,
          preview: {
            filesAffected: filesChanged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      return {
        success: true,
        message: `Renamed to "${validated.newName}"${warningMessage}`,
        filesChanged,
        changes,
        nextActions: [
          'organize_imports - Clean up import statements',
          'fix_all - Fix any type errors from rename'
        ]
      };
    } catch (error) {
      return {
        success: false,
        message: `Rename failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that the TypeScript project is configured correctly
  3. Verify the new name is a valid identifier`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Rename Symbol',
      description: `Rename across ALL files + update imports/exports automatically. TypeScript-aware renaming catches dynamic imports, re-exports, and type references that text search misses. Completes in <1s vs 5-10min manual search/replace with risk of missed references.

Example: Rename 'calculateSum' to 'computeSum'
  ✓ Updates function declaration
  ✓ Updates all call sites: calculateSum(1, 2) → computeSum(1, 2)
  ✓ Updates all imports across files
  ✓ Updates all exports and re-exports
  ✓ Processes all references instantly`,
      inputSchema: renameSchema.shape
    };
  }
}