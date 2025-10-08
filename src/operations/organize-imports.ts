/**
 * Organize imports operation handler
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSOrganizeImportsResponse } from '../language-servers/typescript/tsserver-types.js';

export const organizeImportsSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional()
});

export class OrganizeImportsOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = organizeImportsSchema.parse(input);
      const filePath = resolve(validated.filePath);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(filePath);

      const result = await this.tsServer.sendRequest<TSOrganizeImportsResponse[]>('organizeImports', {
        scope: {
          type: 'file',
          args: { file: filePath }
        }
      });

      if (!result || result.length === 0 || !result[0]?.textChanges || result[0].textChanges.length === 0) {
        return {
          success: true,
          message: 'No import changes needed',
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

      // Apply changes in reverse order to maintain positions
      const sortedChanges = [...result[0].textChanges].sort((a, b) => {
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

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: 'Preview: Would organize imports',
          filesChanged: [fileChanges],
          preview: {
            filesAffected: 1,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      // Only write if not in preview mode
      await writeFile(filePath, updatedContent);

      return {
        success: true,
        message: 'Organized imports',
        filesChanged: [fileChanges]
      };
    } catch (error) {
      return {
        success: false,
        message: `Organize imports failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and has valid import statements
  2. Check that all imported modules can be resolved
  3. Verify TypeScript configuration is correct`,
        filesChanged: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Organize Imports',
      description: `Sort + remove unused imports with TypeScript compiler accuracy. Preserves side-effect imports, handles type-only imports correctly, and respects import order rules. More thorough than ESLint - catches unused imports that static analysis misses due to type-only usage.

Example: Messy imports
  Input:
    import { z } from 'unused';
    import { c, a, b } from '../utils.js';
  Output:
    import { a, b, c } from '../utils.js';
  ✓ Alphabetically sorted
  ✓ Unused imports removed
  ✓ Side-effect imports preserved`,
      inputSchema: organizeImportsSchema.shape
    };
  }
}