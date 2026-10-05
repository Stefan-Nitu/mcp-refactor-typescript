/**
 * Remove unused code operation handler
 */

import { z } from 'zod';
import type {
  RefactorResult,
  TypeScriptServer,
} from '../language-servers/typescript/tsserver-client.js';
import type {
  TSCombinedCodeFix,
  TSDiagnostic,
  TSTextChange,
} from '../language-servers/typescript/tsserver-types.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { EditApplicator } from './shared/edit-applicator.js';
import type { FileOperations } from './shared/file-operations.js';
import { describeKept, keepSideEffects } from './shared/side-effect-guard.js';
import type { TSServerGuard } from './shared/tsserver-guard.js';

// Declared but never read (6133) or never used (6196), and an import
// declaration none of whose names are used (6192)
const UNUSED_CODES = new Set([6133, 6192, 6196]);

// TypeScript splits its unused-identifier fixes by the diagnostic behind each
// edit: the first family skips every import except a namespace import beside
// a used default one, and the second takes exactly the imports the first
// skips. Both are computed from the same text and their edits are applied
// without reconciling overlaps, so no import may be edited by both - nor by
// organizeImports, which rewrites every import in the file
const FIX_IDS = ['unusedIdentifier_delete', 'unusedIdentifier_deleteImports'];

export const removeUnusedSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional(),
});

export class RemoveUnusedOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private editApplicator: EditApplicator,
    private tsServerGuard: TSServerGuard,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = removeUnusedSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(filePath);

      if (!(await this.reportsUnusedCode(filePath))) {
        return {
          success: true,
          message: 'No unused code found',
          filesChanged: [],
        };
      }

      const allTextChanges: TSTextChange[] = [];
      for (const fixId of FIX_IDS) {
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

        for (const fileEdit of combinedFix?.changes ?? []) {
          if (fileEdit.fileName === filePath) {
            allTextChanges.push(...fileEdit.textChanges);
          }
        }
      }

      if (allTextChanges.length === 0) {
        return {
          success: true,
          message: 'No unused code to remove',
          filesChanged: [],
        };
      }

      const originalLines = await this.fileOps.readLines(filePath);
      const { changes, kept } = await keepSideEffects(
        filePath,
        originalLines.join('\n'),
        allTextChanges,
      );
      const keptNote = describeKept(kept, validated.preview === true);

      if (changes.length === 0) {
        return {
          success: true,
          message: `No unused code to remove${keptNote}`,
          filesChanged: [],
        };
      }

      const sortedChanges = this.editApplicator.sortEdits(changes);
      const fileChanges = this.editApplicator.buildFileChanges(
        originalLines,
        sortedChanges,
        filePath,
      );
      const updatedLines = this.editApplicator.applyEdits(
        originalLines,
        sortedChanges,
      );

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would remove ${sortedChanges.length} unused declaration(s)${keptNote}`,
          filesChanged: [fileChanges],
          preview: {
            filesAffected: 1,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes',
          },
        };
      }

      await this.fileOps.writeLines(filePath, updatedLines);

      return {
        success: true,
        message: `Removed ${sortedChanges.length} unused declaration(s)${keptNote}`,
        filesChanged: [fileChanges],
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      return {
        success: false,
        message: `Remove unused failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that TypeScript can compile the file`,
        filesChanged: [],
      };
    }
  }

  /**
   * TypeScript reports unused code as suggestions, except where noUnusedLocals
   * or noUnusedParameters makes it an error - and then it is reported among
   * the semantic diagnostics instead, and the suggestions leave it out
   */
  private async reportsUnusedCode(filePath: string): Promise<boolean> {
    for (const command of [
      'suggestionDiagnosticsSync',
      'semanticDiagnosticsSync',
    ]) {
      const diagnostics = await this.tsServer.sendRequest<TSDiagnostic[]>(
        command,
        {
          file: filePath,
          includeLinePosition: true,
        },
      );

      if (diagnostics?.some(({ code }) => UNUSED_CODES.has(code))) {
        return true;
      }
    }

    return false;
  }
}
