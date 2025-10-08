/**
 * Rename operation handler
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRenameLoc, TSRenameResponse } from '../language-servers/typescript/tsserver-types.js';

export const renameSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty'),
  newName: z.string().min(1, 'New name cannot be empty'),
  preview: z.boolean().optional()
});

export class RenameOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = renameSchema.parse(input);

      // Normalize relative paths to absolute
      const absoluteFilePath = resolve(validated.filePath);

      // Convert text to column position
      const fileContent = await readFile(absoluteFilePath, 'utf8');
      const lines = fileContent.split('\n');
      const lineIndex = validated.line - 1;

      if (lineIndex < 0 || lineIndex >= lines.length) {
        return {
          success: false,
          message: `Line ${validated.line} is out of range (file has ${lines.length} lines)`,
          filesChanged: []
        };
      }

      const lineContent = lines[lineIndex];
      const textIndex = lineContent.indexOf(validated.text);

      if (textIndex === -1) {
        return {
          success: false,
          message: `Text "${validated.text}" not found on line ${validated.line}

Line content: ${lineContent}

Try:
  1. Check the text matches exactly (case-sensitive)
  2. Ensure you're on the correct line`,
          filesChanged: []
        };
      }

      const column = textIndex + 1;

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(absoluteFilePath);

      await this.tsServer.discoverAndOpenImportingFiles(absoluteFilePath);

      const projectFullyLoaded = this.tsServer.isProjectLoaded();
      const scanTimedOut = this.tsServer.didLastScanTimeout();

      const renameInfo = await this.tsServer.sendRequest('rename', {
        file: absoluteFilePath,
        line: validated.line,
        offset: column,
        findInComments: false,
        findInStrings: false
      }) as TSRenameResponse | null;

      if (!renameInfo?.locs) {
        return {
          success: false,
          message: `Cannot rename: No symbol found for "${validated.text}" at ${absoluteFilePath}:${validated.line}

Try:
  1. Check that the text is a valid identifier
  2. Use find_references to verify the symbol exists
  3. Ensure the file is saved and TypeScript can analyze it`,
          filesChanged: [],
        };
      }

      const filesChanged: RefactorResult['filesChanged'] = [];

      for (const fileLoc of renameInfo.locs) {
        const fileContent = await readFile(fileLoc.file, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileLoc.file.split('/').pop() || fileLoc.file,
          path: fileLoc.file,
          edits: [] as RefactorResult['filesChanged'][0]['edits']
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
        filesChanged.push(fileChanges);
      }

      let warningMessage = '';
      if (!projectFullyLoaded) {
        warningMessage += '\n\nWarning: TypeScript is still indexing the project. Some references may have been missed.';
      }
      if (scanTimedOut) {
        warningMessage += '\n\nWarning: File discovery timed out. Some files may not have been scanned. References might be incomplete.';
      }
      if (warningMessage) {
        warningMessage += ' If results seem incomplete, try running the operation again.';
      }

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would rename to "${validated.newName}" in ${filesChanged.length} file(s)${warningMessage}`,
          filesChanged,
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
      };
    }
  }

  getSchema() {
    return {
      title: 'Rename Symbol',
      description: `Rename across ALL files + update imports/exports automatically. TypeScript-aware renaming catches dynamic imports, re-exports, and type references that text search misses. Completes in <1s vs 5-10min manual search/replace with risk of missed references.

Example: Rename 'calculateSum' to 'computeSum'
  Input: { filePath, line: 1, text: "calculateSum", newName: "computeSum" }
  ✓ Updates function declaration
  ✓ Updates all call sites: calculateSum(1, 2) → computeSum(1, 2)
  ✓ Updates all imports across files
  ✓ Updates all exports and re-exports
  ✓ Processes all references instantly`,
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        line: z.number().int().positive('Line must be a positive integer'),
        text: z.string().min(1, 'Text cannot be empty'),
        newName: z.string().min(1, 'New name cannot be empty'),
        preview: z.boolean().optional()
      }
    };
  }
}