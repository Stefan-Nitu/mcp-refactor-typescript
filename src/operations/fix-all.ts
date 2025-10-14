/**
 * Fix all operation handler
 */

import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type {
  TSCodeFixAction,
  TSCombinedCodeFix,
  TSDiagnostic,
  TSFileEdit,
  TSTextChange
} from '../language-servers/typescript/tsserver-types.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const fixAllSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional()
});

export class FixAllOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private editApplicator: EditApplicator,
    private tsServerGuard: TSServerGuard
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = fixAllSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(filePath);

      const diagnosticsResult = await this.tsServer.sendRequest<TSDiagnostic[]>('semanticDiagnosticsSync', {
        file: filePath,
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
          file: filePath,
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
            args: { file: filePath }
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
          message: `Preview: Would apply ${sortedChanges.length} fix(es)`,
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

}
