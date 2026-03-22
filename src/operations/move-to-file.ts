/**
 * Move to file operation handler
 */

import { mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { z } from 'zod';
import type {
  RefactorResult,
  TypeScriptServer,
} from '../language-servers/typescript/tsserver-client.js';
import type {
  TSRefactorEditInfo,
  TSRefactorInfo,
} from '../language-servers/typescript/tsserver-types.js';
import { logger } from '../utils/logger.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { EditApplicator } from './shared/edit-applicator.js';
import type { FileOperations } from './shared/file-operations.js';
import type { FormatConfigurator } from './shared/format-configurator.js';
import type { TextPositionConverter } from './shared/text-position-converter.js';
import type { TSServerGuard } from './shared/tsserver-guard.js';

export const moveToFileSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty'),
  destinationPath: z.string().optional(),
  preview: z.boolean().optional(),
});

export class MoveToFileOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private textConverter: TextPositionConverter,
    private editApplicator: EditApplicator,
    private formatConfigurator: FormatConfigurator,
    private tsServerGuard: TSServerGuard,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = moveToFileSchema.parse(input);
      const { line, text, destinationPath } = validated;
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const lines = await this.fileOps.readLines(filePath);
      const positionResult = this.textConverter.findTextPosition(
        lines,
        line,
        text,
      );

      if (!positionResult.success) {
        return {
          success: false,
          message: positionResult.message,
          filesChanged: [],
        };
      }

      const { startLine, startColumn, endLine, endColumn } = positionResult;

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(filePath);

      const refactors = (await this.tsServer.sendRequest(
        'getApplicableRefactors',
        {
          file: filePath,
          startLine,
          startOffset: startColumn,
          endLine,
          endOffset: endColumn,
          ...(destinationPath ? { includeInteractiveActions: true } : {}),
        },
      )) as TSRefactorInfo[] | null;

      logger.debug({ refactors }, 'Available refactorings for move');

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: `Cannot move symbol: No refactorings available for "${text}" at ${filePath}:${line}

Try:
  1. Select a top-level declaration (function, class, type, interface, const)
  2. Ensure the symbol is exported or a standalone declaration
  3. The selection must cover the full declaration`,
          filesChanged: [],
        };
      }

      const refactorName = destinationPath
        ? 'Move to file'
        : 'Move to a new file';
      const moveRefactor = refactors.find((r) => r.name === refactorName);

      logger.info({ actions: moveRefactor?.actions }, 'Available move actions');

      if (!moveRefactor) {
        const available = refactors.map((r) => r.name).join(', ');
        return {
          success: false,
          message: `"${refactorName}" not available for "${text}" at ${filePath}:${line}

Available refactorings: ${available}

Tips:
  1. Select a top-level declaration (function, class, type, interface, const)
  2. Ensure the symbol is exported or a standalone declaration
  3. The selection must cover the full declaration`,
          filesChanged: [],
        };
      }

      const moveAction = moveRefactor.actions[0];
      if (!moveAction) {
        return {
          success: false,
          message: 'No move action available',
          filesChanged: [],
        };
      }

      await this.formatConfigurator.configureForFile(filePath, lines);

      const resolvedDestination = destinationPath
        ? this.fileOps.resolvePath(destinationPath)
        : undefined;

      const edits = await this.tsServer.sendRequest<TSRefactorEditInfo>(
        'getEditsForRefactor',
        {
          file: filePath,
          startLine,
          startOffset: startColumn,
          endLine,
          endOffset: endColumn,
          refactor: moveRefactor.name,
          action: moveAction.name,
          ...(resolvedDestination
            ? {
                interactiveRefactorArguments: {
                  targetFile: resolvedDestination,
                },
              }
            : {}),
        },
      );

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: `No edits generated for move operation

This might indicate:
  1. TypeScript LSP encountered an internal error
  2. The selection is invalid or too complex
  3. Try restarting the TypeScript server`,
          filesChanged: [],
        };
      }

      const filesChanged: RefactorResult['filesChanged'] = [];

      for (const fileEdit of edits.edits) {
        if (fileEdit.textChanges.length === 0) continue;

        let isNewFile = false;
        const originalLines = await this.fileOps
          .readLines(fileEdit.fileName)
          .catch(() => {
            isNewFile = true;
            return [''];
          });

        if (isNewFile) {
          const newContent = fileEdit.textChanges
            .map((c) => c.newText)
            .join('');
          const newLines = newContent.split('\n');
          const fileName = basename(fileEdit.fileName);

          if (!validated.preview) {
            await mkdir(dirname(fileEdit.fileName), { recursive: true });
            await this.fileOps.writeLines(fileEdit.fileName, newLines);
          }

          filesChanged.push({
            file: fileName,
            path: fileEdit.fileName,
            edits: [{ line: 1, column: 1, old: '', new: newContent }],
          });
        } else {
          const sortedChanges = this.editApplicator.sortEdits(
            fileEdit.textChanges,
          );
          const fileChanges = this.editApplicator.buildFileChanges(
            originalLines,
            sortedChanges,
            fileEdit.fileName,
          );
          const updatedLines = this.editApplicator.applyEdits(
            originalLines,
            sortedChanges,
          );

          if (!validated.preview) {
            await this.fileOps.writeLines(fileEdit.fileName, updatedLines);
          }

          filesChanged.push(fileChanges);
        }
      }

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would move symbol to ${destinationPath || 'a new file'}`,
          filesChanged,
          preview: {
            filesAffected: filesChanged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes',
          },
        };
      }

      return {
        success: true,
        message: `Moved symbol to ${destinationPath || 'new file'}`,
        filesChanged,
        nextActions: ['organize_imports - Clean up imports in affected files'],
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      return {
        success: false,
        message: `Move to file failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure the selected symbol is a top-level declaration
  3. Verify the destination path is valid`,
        filesChanged: [],
      };
    }
  }
}
