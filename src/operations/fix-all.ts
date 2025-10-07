/**
 * Fix all operation handler
 */

import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type {
  TSDiagnostic,
  TSCodeFixAction,
  TSCombinedCodeFix,
  TSFileEdit,
  TSTextChange
} from '../language-servers/typescript/tsserver-types.js';

export const fixAllSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional()
});

export class FixAllOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = fixAllSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(validated.filePath);

      const diagnosticsResult = await this.tsServer.sendRequest<TSDiagnostic[]>('semanticDiagnosticsSync', {
        file: validated.filePath,
        includeLinePosition: true
      });

      if (!diagnosticsResult || diagnosticsResult.length === 0) {
        return {
          success: true,
          message: 'No fixes needed',
          filesChanged: []
        };
      }

      const fixIdToApply = new Set<string>();

      for (const diagnostic of diagnosticsResult) {
        const startLine = diagnostic.startLocation?.line ?? 1;
        const startOffset = diagnostic.startLocation?.offset ?? 1;
        const endLine = diagnostic.endLocation?.line ?? startLine;
        const endOffset = diagnostic.endLocation?.offset ?? startOffset;

        const fixes = await this.tsServer.sendRequest<TSCodeFixAction[]>('getCodeFixes', {
          file: validated.filePath,
          startLine,
          endLine,
          startOffset,
          endOffset,
          errorCodes: [diagnostic.code]
        });

        if (fixes && fixes.length > 0) {
          for (const fix of fixes) {
            if (fix.fixId) {
              fixIdToApply.add(fix.fixId);
            }
          }
        }
      }

      if (fixIdToApply.size === 0) {
        return {
          success: true,
          message: 'No auto-fixable errors found',
          filesChanged: []
        };
      }

      let allChanges: TSFileEdit[] = [];

      for (const fixId of fixIdToApply) {
        const combinedFix = await this.tsServer.sendRequest<TSCombinedCodeFix>('getCombinedCodeFix', {
          scope: {
            type: 'file',
            args: { file: validated.filePath }
          },
          fixId
        });

        if (combinedFix?.changes) {
          allChanges = allChanges.concat(combinedFix.changes);
        }
      }

      if (allChanges.length === 0) {
        return {
          success: true,
          message: 'No fixes applied',
          filesChanged: []
        };
      }

      const fileContent = await readFile(validated.filePath, 'utf8');
      const lines = fileContent.split('\n');

      const fileChanges = {
        file: validated.filePath.split('/').pop() || validated.filePath,
        path: validated.filePath,
        edits: [] as RefactorResult['filesChanged'][0]['edits']
      };

      const allTextChanges: TSTextChange[] = [];
      for (const fileEdit of allChanges) {
        if (fileEdit.fileName === validated.filePath) {
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
          message: `Preview: Would apply ${sortedChanges.length} fix(es)`,
          filesChanged: [fileChanges],
          preview: {
            filesAffected: 1,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      await writeFile(validated.filePath, updatedContent);

      return {
        success: true,
        message: `Applied ${sortedChanges.length} fix(es)`,
        filesChanged: [fileChanges],
        nextActions: [
          'organize_imports - Clean up imports after fixes'
        ]
      };
    } catch (error) {
      return {
        success: false,
        message: `Fix all failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that TypeScript can compile the file
  3. Some errors may not be auto-fixable`,
        filesChanged: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Fix All',
      description: `Auto-fix ALL TypeScript errors at once with compiler-grade accuracy. Type-aware fixes that preserve correctness - adds missing properties, fixes type mismatches, converts to async/await, and more. Safer than manual fixes because it understands the type system.

Example: Fix file with unused imports
  Input: File with unused imports from 'fs/promises'
  ✓ Removes unused imports automatically
  ✓ Applies all available quick fixes
  ✓ Preserves code correctness
  Result: "Applied X fix(es)" or "No fixes needed"`,
      inputSchema: fixAllSchema.shape
    };
  }
}