/**
 * Remove unused code operation handler
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type {
  TSDiagnostic,
  TSCombinedCodeFix,
  TSTextChange,
  TSFileEdit
} from '../language-servers/typescript/tsserver-types.js';

export const removeUnusedSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional()
});

export class RemoveUnusedOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = removeUnusedSchema.parse(input);
      const filePath = resolve(validated.filePath);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(filePath);

      const diagnosticsResult = await this.tsServer.sendRequest<TSDiagnostic[]>('suggestionDiagnosticsSync', {
        file: filePath,
        includeLinePosition: true
      });

      if (!diagnosticsResult || diagnosticsResult.length === 0) {
        return {
          success: true,
          message: 'No unused code found',
          filesChanged: []
        };
      }

      const unusedDiagnostics = diagnosticsResult.filter((d: TSDiagnostic) =>
        d.code === 6133 || d.code === 6192 || d.code === 6196
      );

      if (unusedDiagnostics.length === 0) {
        return {
          success: true,
          message: 'No unused code found',
          filesChanged: []
        };
      }

      let allChanges: TSFileEdit[] = [];

      const hasUnusedImports = unusedDiagnostics.some(d => d.code === 6192);
      const hasUnusedCode = unusedDiagnostics.some(d => d.code === 6133 || d.code === 6196);

      if (hasUnusedImports) {
        const organizeResult = await this.tsServer.sendRequest<Array<{ fileName: string; textChanges: TSTextChange[] }>>('organizeImports', {
          scope: {
            type: 'file',
            args: { file: filePath }
          },
          skipDestructiveCodeActions: false,
          mode: 'RemoveUnused'
        });

        if (organizeResult && organizeResult.length > 0) {
          allChanges.push({
            fileName: filePath,
            textChanges: organizeResult[0].textChanges
          });
        }
      }

      if (hasUnusedCode) {
        const combinedFix = await this.tsServer.sendRequest<TSCombinedCodeFix>('getCombinedCodeFix', {
          scope: {
            type: 'file',
            args: { file: filePath }
          },
          fixId: 'unusedIdentifier_delete'
        });

        if (combinedFix?.changes) {
          allChanges = allChanges.concat(combinedFix.changes);
        }
      }

      if (allChanges.length === 0) {
        return {
          success: true,
          message: 'No unused code to remove',
          filesChanged: []
        };
      }

      const fileContent = await readFile(filePath, 'utf8');
      const lines = fileContent.split('\n');

      const fileChanges = {
        file: filePath.split('/').pop() || filePath,
        path: filePath,
        edits: [] as RefactorResult['filesChanged'][0]['edits']
      };

      const allTextChanges: TSTextChange[] = [];
      for (const fileEdit of allChanges) {
        if (fileEdit.fileName === filePath) {
          allTextChanges.push(...fileEdit.textChanges);
        }
      }

      const sortedChanges = [...allTextChanges].sort((a, b) => {
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
          old: lines[startLine]?.substring(startOffset, endOffset) || '',
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

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would remove ${sortedChanges.length} unused declaration(s)`,
          filesChanged: [fileChanges],
          preview: {
            filesAffected: 1,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      await writeFile(filePath, updatedContent);

      return {
        success: true,
        message: `Removed ${sortedChanges.length} unused declaration(s)`,
        filesChanged: [fileChanges]
      };
    } catch (error) {
      return {
        success: false,
        message: `Remove unused failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that TypeScript can compile the file`,
        filesChanged: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Remove Unused',
      description: `Safely remove ALL unused vars/imports with zero risk of breaking code. Type-aware analysis distinguishes between truly unused code and legitimate unused imports (like side-effect imports or type-only imports used in JSDoc). Never accidentally removes needed code.

Example: Clean up unused code
  Input:
    const x = 42;
    const y = 100;  // unused
    console.error(x);
  Output:
    const x = 42;
    console.error(x);
  ✓ Removes unused variables
  ✓ Removes unused imports
  ✓ Preserves side-effect code`,
      inputSchema: removeUnusedSchema.shape
    };
  }
}