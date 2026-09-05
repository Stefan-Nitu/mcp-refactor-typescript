/**
 * Batch move files operation handler
 */

import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { FileDiscovery } from './shared/file-discovery.js';
import type { FileMover } from './shared/file-mover.js';
import type { TSServerGuard } from './shared/tsserver-guard.js';

type FileChanges = RefactorResult['filesChanged'];
type MoveChanges = { source: string; changes: FileChanges };

const positionKey = (
  path: string,
  edit: FileChanges[number]['edits'][number],
) => `${path}:${edit.line}:${edit.column}`;

export const batchMoveFilesSchema = z.object({
  files: z
    .array(z.string().min(1))
    .min(1, 'At least one file must be provided'),
  targetFolder: z.string().min(1, 'Target folder cannot be empty'),
  preview: z.boolean().optional(),
});

export class BatchMoveFilesOperation {
  constructor(
    private guard: TSServerGuard,
    private discovery: FileDiscovery,
    private helper: FileMover,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchMoveFilesSchema.parse(input);
      const files = validated.files.map((f) => resolve(f));
      const targetFolder = resolve(validated.targetFolder);

      const guardResult = await this.guard.ensureReady();
      if (guardResult) return guardResult;

      if (!validated.preview) {
        await mkdir(targetFolder, { recursive: true });
      }

      const projectStatus = await this.discovery.discoverRelatedFiles(files);

      const collected: MoveChanges[] = [];
      let successCount = 0;
      const errors: string[] = [];

      for (const sourceFile of files) {
        const fileName = basename(sourceFile);
        const destinationPath = join(targetFolder, fileName);

        try {
          const result = await this.helper.performMove(
            sourceFile,
            destinationPath,
            validated.preview,
          );

          if (result.success) {
            successCount++;
            if (result.filesChanged) {
              collected.push({
                source: sourceFile,
                changes: result.filesChanged,
              });
            }
          } else {
            errors.push(`${fileName}: ${result.message}`);
          }
        } catch (error) {
          errors.push(
            `${fileName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (errors.length > 0 && successCount === 0) {
        return {
          success: false,
          message: `Failed to move all files:
${errors.join('\n')}

Try:
  1. Check that all source files exist
  2. Ensure target folder is writable
  3. Verify no filename conflicts in destination`,
          filesChanged: [],
        };
      }

      const allFilesChanged = this.mergeChanges(
        validated.preview
          ? this.resolveSiblingImports(collected, new Set(files))
          : collected,
      );

      const warningMessage = this.discovery.buildWarningMessage(
        projectStatus,
        'import updates',
      );

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would move ${successCount} file(s) to ${basename(validated.targetFolder)}${warningMessage}`,
          filesChanged: allFilesChanged,
          preview: {
            filesAffected: successCount,
            estimatedTime: '< 2s',
            command: 'Run again with preview: false to apply changes',
          },
        };
      }

      const message =
        errors.length > 0
          ? `Moved ${successCount} file(s), ${errors.length} failed:\n${errors.join('\n')}`
          : `Moved ${successCount} file(s) to ${basename(validated.targetFolder)}`;

      return {
        success: true,
        message: message + warningMessage,
        filesChanged: allFilesChanged,
        nextActions: [
          'organize_imports - Clean up all import statements',
          'fix_all - Fix any errors from the moves',
        ],
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }
      return {
        success: false,
        message: `Batch move files failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure all source files exist
  2. Check that target folder path is valid
  3. Verify you have write permissions`,
        filesChanged: [],
      };
    }
  }

  private mergeChanges(collected: MoveChanges[]): FileChanges {
    const merged: FileChanges = [];

    for (const { changes } of collected) {
      for (const fileChange of changes) {
        const existingFile = merged.find((f) => f.path === fileChange.path);
        if (existingFile) {
          existingFile.edits.push(...fileChange.edits);
        } else {
          merged.push(fileChange);
        }
      }
    }

    return merged;
  }

  /**
   * A preview computes every move against the original layout, so an import
   * between two files of the same batch comes back twice - once per file, each
   * answer assuming the other one stays put. Both land in targetFolder, so the
   * truth is `./<imported file>`, which is usually the specifier already there.
   * A real run needs none of this: each move is on disk before the next one is
   * computed.
   */
  private resolveSiblingImports(
    collected: MoveChanges[],
    batchFiles: Set<string>,
  ): MoveChanges[] {
    const siblingSpecifiers = new Map<string, string>();

    for (const { source, changes } of collected) {
      for (const fileChange of changes) {
        if (fileChange.path === source || !batchFiles.has(fileChange.path)) {
          continue;
        }
        for (const edit of fileChange.edits) {
          siblingSpecifiers.set(
            positionKey(fileChange.path, edit),
            `./${edit.old.split('/').pop()}`,
          );
        }
      }
    }

    const resolved = new Set<string>();

    return collected.map(({ source, changes }) => ({
      source,
      changes: changes
        .map((fileChange) => ({
          ...fileChange,
          edits: fileChange.edits.flatMap((edit) => {
            const key = positionKey(fileChange.path, edit);
            const specifier = siblingSpecifiers.get(key);

            if (specifier === undefined) return [edit];
            if (specifier === edit.old || resolved.has(key)) return [];

            resolved.add(key);
            return [{ ...edit, new: specifier }];
          }),
        }))
        .filter((fileChange) => fileChange.edits.length > 0),
    }));
  }
}
