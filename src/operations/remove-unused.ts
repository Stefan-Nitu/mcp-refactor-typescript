/**
 * Remove unused code operation handler
 */

import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type {
  TSDiagnostic,
  TSCombinedCodeFix,
  TSTextChange,
  TSFileEdit
} from '../language-servers/typescript/tsserver-types.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const removeUnusedSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional()
});

export class RemoveUnusedOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations = new FileOperations(),
    private editApplicator: EditApplicator = new EditApplicator(),
    private tsServerGuard: TSServerGuard = new TSServerGuard(tsServer)
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = removeUnusedSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

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

      const allTextChanges: TSTextChange[] = [];
      for (const fileEdit of allChanges) {
        if (fileEdit.fileName === filePath) {
          allTextChanges.push(...fileEdit.textChanges);
        }
      }

      const originalLines = await this.fileOps.readLines(filePath);
      const sortedChanges = this.editApplicator.sortEdits(allTextChanges);
      const fileChanges = this.editApplicator.buildFileChanges(originalLines, sortedChanges, filePath);
      const updatedLines = this.editApplicator.applyEdits(originalLines, sortedChanges);

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

      await this.fileOps.writeLines(filePath, updatedLines);

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

}
