/**
 * Organize imports operation handler
 */

import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSOrganizeImportsResponse } from '../language-servers/typescript/tsserver-types.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';

export const organizeImportsSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional()
});

export class OrganizeImportsOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations = new FileOperations(),
    private editApplicator: EditApplicator = new EditApplicator()
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = organizeImportsSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

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

      const originalLines = await this.fileOps.readLines(filePath);
      const sortedChanges = this.editApplicator.sortEdits(result[0].textChanges);
      const fileChanges = this.editApplicator.buildFileChanges(originalLines, sortedChanges, filePath);
      const updatedLines = this.editApplicator.applyEdits(originalLines, sortedChanges);

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

      await this.fileOps.writeLines(filePath, updatedLines);

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