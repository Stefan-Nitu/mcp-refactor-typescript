/**
 * Fix all operation handler
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import type { TSCodeFixAction } from '../language-servers/typescript/tsserver-types.js';

export const fixAllSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty')
});

export type FixAllInput = z.infer<typeof fixAllSchema>;

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

      const result = await this.tsServer.sendRequest<TSCodeFixAction[]>('getCodeFixes', {
        file: validated.filePath,
        startLine: 1,
        startOffset: 1,
        endLine: 99999,
        endOffset: 1,
        errorCodes: []
      });

      if (!result || result.length === 0) {
        return {
          success: true,
          message: 'No fixes needed',
          filesChanged: [],
          changes: []
        };
      }

      const fileContent = await readFile(validated.filePath, 'utf8');
      let updatedContent = fileContent;

      const fileChanges = {
        file: validated.filePath.split('/').pop() || validated.filePath,
        path: validated.filePath,
        edits: [] as RefactorResult['changes'][0]['edits']
      };

      interface ChangeWithSpan { span: { start: number; length: number }; newText: string }
      const allChanges: ChangeWithSpan[] = [];

      for (const fix of result) {
        for (const change of fix.changes) {
          if (change.textChanges) {
            for (const textChange of change.textChanges as unknown as ChangeWithSpan[]) {
              allChanges.push(textChange);
            }
          }
        }
      }

      allChanges.sort((a, b) => b.span.start - a.span.start);

      for (const change of allChanges) {
        fileChanges.edits.push({
          line: 0,
          old: fileContent.substring(change.span.start, change.span.start + change.span.length),
          new: change.newText
        });

        updatedContent =
          updatedContent.substring(0, change.span.start) +
          change.newText +
          updatedContent.substring(change.span.start + change.span.length);
      }

      await writeFile(validated.filePath, updatedContent);

      return {
        success: true,
        message: `Applied ${result.length} fix(es)`,
        filesChanged: [validated.filePath],
        changes: [fileChanges],
        nextActions: [
          'organize_imports - Clean up imports after fixes'
        ]
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Fix all failed: ${error instanceof Error ? error.message : String(error)}

💡 Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that TypeScript can compile the file
  3. Some errors may not be auto-fixable`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Fix All',
      description: `⚡ Auto-fix ALL TypeScript errors at once with compiler-grade accuracy. Type-aware fixes that preserve correctness - adds missing properties, fixes type mismatches, converts to async/await, and more. Safer than manual fixes because it understands the type system.

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