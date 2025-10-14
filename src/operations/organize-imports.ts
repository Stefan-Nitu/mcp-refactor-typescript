/**
 * Organize imports operation handler
 */

import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSOrganizeImportsResponse } from '../language-servers/typescript/tsserver-types.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';
import { FormatConfigurator } from './shared/format-configurator.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const organizeImportsSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional()
});

export class OrganizeImportsOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private editApplicator: EditApplicator,
    private formatConfigurator: FormatConfigurator,
    private tsServerGuard: TSServerGuard
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = organizeImportsSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(filePath);

      const originalLines = await this.fileOps.readLines(filePath);
      await this.formatConfigurator.configureForFile(filePath, originalLines);

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

}
