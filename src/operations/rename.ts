/**
 * Rename operation handler
 */

import { z } from 'zod';
import type {
  RefactorResult,
  TypeScriptServer,
} from '../language-servers/typescript/tsserver-client.js';
import type {
  TSRenameLoc,
  TSRenameResponse,
} from '../language-servers/typescript/tsserver-types.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { EditApplicator } from './shared/edit-applicator.js';
import type { FileDiscovery } from './shared/file-discovery.js';
import type { FileOperations } from './shared/file-operations.js';
import type { TextPositionConverter } from './shared/text-position-converter.js';
import type { TSServerGuard } from './shared/tsserver-guard.js';

export const renameSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty'),
  name: z.string().min(1, 'Name cannot be empty'),
  preview: z.boolean().optional(),
});

export class RenameOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private textConverter: TextPositionConverter,
    private editApplicator: EditApplicator,
    private tsServerGuard: TSServerGuard,
    private fileDiscovery: FileDiscovery,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = renameSchema.parse(input);
      const absoluteFilePath = this.fileOps.resolvePath(validated.filePath);

      const lines = await this.fileOps.readLines(absoluteFilePath);
      const positionResult = this.textConverter.findTextPosition(
        lines,
        validated.line,
        validated.text,
      );

      if (!positionResult.success) {
        return {
          success: false,
          message: positionResult.message,
          filesChanged: [],
        };
      }

      const column = positionResult.startColumn;

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      const projectStatus =
        await this.fileDiscovery.discoverRelatedFiles(absoluteFilePath);

      const renameInfo = (await this.tsServer.sendRequest('rename', {
        file: absoluteFilePath,
        line: validated.line,
        offset: column,
        findInComments: false,
        findInStrings: false,
      })) as TSRenameResponse | null;

      if (!renameInfo?.locs) {
        return {
          success: false,
          message: `Cannot rename: No symbol found for "${validated.text}" at ${absoluteFilePath}:${validated.line}

Try:
  1. Check that the text is a valid identifier
  2. Use find_references to verify the symbol exists
  3. Ensure the file is saved and TypeScript can analyze it`,
          filesChanged: [],
        };
      }

      const filesChanged: RefactorResult['filesChanged'] = [];
      // Every file is read and computed before any is written: writing inside
      // this loop meant a failure part-way through left the symbol renamed in
      // the files already visited and untouched in the rest
      const staged: Array<{ path: string; lines: string[] }> = [];

      for (const fileLoc of renameInfo.locs) {
        const originalLines = await this.fileOps.readLines(fileLoc.file);

        const renamedChanges = fileLoc.locs.map((loc: TSRenameLoc) => ({
          start: loc.start,
          end: loc.end,
          newText: validated.name,
        }));

        const sortedChanges = this.editApplicator.sortEdits(renamedChanges);
        filesChanged.push(
          this.editApplicator.buildFileChanges(
            originalLines,
            sortedChanges,
            fileLoc.file,
          ),
        );
        staged.push({
          path: fileLoc.file,
          lines: this.editApplicator.applyEdits(originalLines, sortedChanges),
        });
      }

      if (!validated.preview) {
        for (const { path, lines } of staged) {
          await this.fileOps.writeLines(path, lines);
        }
      }

      const warningMessage = this.fileDiscovery.buildWarningMessage(
        projectStatus,
        'references',
      );

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would rename to "${validated.name}" in ${filesChanged.length} file(s)${warningMessage}`,
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
        message: `Renamed to "${validated.name}"${warningMessage}`,
        filesChanged,
        nextActions: [
          'organize_imports - Clean up import statements',
          'fix_all - Fix any type errors from rename',
        ],
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      return {
        success: false,
        message: `Rename failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that the TypeScript project is configured correctly
  3. Verify the new name is a valid identifier`,
        filesChanged: [],
      };
    }
  }
}
