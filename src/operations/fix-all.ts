/**
 * Fix all operation handler
 */

import { z } from 'zod';
import type {
  RefactorResult,
  TypeScriptServer,
} from '../language-servers/typescript/tsserver-client.js';
import type {
  TSCodeFixAction,
  TSCombinedCodeFix,
  TSDiagnostic,
  TSFileEdit,
  TSTextChange,
} from '../language-servers/typescript/tsserver-types.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { EditApplicator } from './shared/edit-applicator.js';
import type { FileOperations } from './shared/file-operations.js';
import type { TSServerGuard } from './shared/tsserver-guard.js';

export const fixAllSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional(),
});

export class FixAllOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private editApplicator: EditApplicator,
    private tsServerGuard: TSServerGuard,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = fixAllSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(filePath);

      const diagnosticsResult = await this.tsServer.sendRequest<TSDiagnostic[]>(
        'semanticDiagnosticsSync',
        {
          file: filePath,
          includeLinePosition: true,
        },
      );

      if (!diagnosticsResult || diagnosticsResult.length === 0) {
        return {
          success: true,
          message: 'No fixes needed',
          filesChanged: [],
        };
      }

      const fixIdToApply = new Set<string>();
      let allChanges: TSFileEdit[] = [];

      for (const diagnostic of diagnosticsResult) {
        const startLine = diagnostic.startLocation?.line ?? 1;
        const startOffset = diagnostic.startLocation?.offset ?? 1;
        const endLine = diagnostic.endLocation?.line ?? startLine;
        const endOffset = diagnostic.endLocation?.offset ?? startOffset;

        const fixes = await this.tsServer.sendRequest<TSCodeFixAction[]>(
          'getCodeFixes',
          {
            file: filePath,
            startLine,
            endLine,
            startOffset,
            endOffset,
            errorCodes: [diagnostic.code],
          },
        );

        if (!fixes || fixes.length === 0) continue;

        for (const fix of fixes) {
          if (fix.fixId) {
            fixIdToApply.add(fix.fixId);
          }
        }

        // A fix with no fixId belongs to no fix-all family, so the combined
        // pass below will never return it. Taken only when it is the
        // diagnostic's sole candidate: several are competing alternatives -
        // which module to import a name from - not a set to apply together.
        if (fixes.length === 1 && !fixes[0].fixId) {
          allChanges = allChanges.concat(fixes[0].changes ?? []);
        }
      }

      for (const fixId of fixIdToApply) {
        const combinedFix = await this.tsServer.sendRequest<TSCombinedCodeFix>(
          'getCombinedCodeFix',
          {
            scope: {
              type: 'file',
              args: { file: filePath },
            },
            fixId,
          },
        );

        if (combinedFix?.changes) {
          allChanges = allChanges.concat(combinedFix.changes);
        }
      }

      if (allChanges.length === 0) {
        return {
          success: true,
          message: 'No auto-fixable errors found',
          filesChanged: [],
        };
      }

      // A fix is free to edit a file other than the one asked about - making
      // a symbol exported from the module that declares it, for one - so the
      // edits are grouped by the file each lands in rather than filtered to
      // the requested one, which used to drop them silently
      const changesByFile = new Map<string, TSTextChange[]>();
      for (const fileEdit of allChanges) {
        const existing = changesByFile.get(fileEdit.fileName) ?? [];
        existing.push(...fileEdit.textChanges);
        changesByFile.set(fileEdit.fileName, existing);
      }

      // Every file is read and computed before any is written, so a failure
      // part-way cannot leave the fix applied to some files and not others
      const staged: Array<{ path: string; lines: string[] }> = [];
      const filesChanged: RefactorResult['filesChanged'] = [];
      let editCount = 0;

      for (const [file, textChanges] of changesByFile) {
        const originalLines = await this.fileOps.readLines(file);
        const sortedChanges = this.editApplicator.sortEdits(textChanges);

        filesChanged.push(
          this.editApplicator.buildFileChanges(
            originalLines,
            sortedChanges,
            file,
          ),
        );
        staged.push({
          path: file,
          lines: this.editApplicator.applyEdits(originalLines, sortedChanges),
        });
        editCount += sortedChanges.length;
      }

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would apply ${editCount} fix(es) in ${staged.length} file(s)`,
          filesChanged,
          preview: {
            filesAffected: staged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes',
          },
        };
      }

      for (const { path, lines } of staged) {
        await this.fileOps.writeLines(path, lines);
      }

      return {
        success: true,
        message: `Applied ${editCount} fix(es) in ${staged.length} file(s)`,
        filesChanged,
        nextActions: ['organize_imports - Clean up imports after fixes'],
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      return {
        success: false,
        message: `Fix all failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that TypeScript can compile the file
  3. Some errors may not be auto-fixable`,
        filesChanged: [],
      };
    }
  }
}
