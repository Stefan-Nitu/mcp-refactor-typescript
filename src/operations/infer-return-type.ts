import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo } from '../language-servers/typescript/tsserver-types.js';
import { Operation } from '../registry.js';
import { logger } from '../utils/logger.js';
import { formatValidationError } from '../utils/validation-error.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';
import { TextPositionConverter } from './shared/text-position-converter.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const inferReturnTypeSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty'),
  preview: z.boolean().optional()
});

export class InferReturnTypeOperation implements Operation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private textConverter: TextPositionConverter,
    private editApplicator: EditApplicator,
    private tsServerGuard: TSServerGuard
  ) {}


  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = inferReturnTypeSchema.parse(input);
      const { line, text } = validated;
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const lines = await this.fileOps.readLines(filePath);
      const positionResult = this.textConverter.findTextPosition(lines, line, text);

      if (!positionResult.success) {
        return {
          success: false,
          message: positionResult.message,
          filesChanged: []
        };
      }

      const column = positionResult.startColumn;

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(filePath);

      const refactors = await this.tsServer.sendRequest('getApplicableRefactors', {
        file: filePath,
        startLine: line,
        startOffset: column,
        endLine: line,
        endOffset: column,
        triggerReason: 'invoked',
        kind: 'refactor.rewrite.function.returnType'
      }) as TSRefactorInfo[] | null;

      logger.debug({ refactors }, 'Available refactorings');

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: `Cannot infer return type: Not available at ${filePath}:${line}:${column}

Try:
  1. Place cursor on a function name or signature
  2. Ensure the function doesn't already have a return type
  3. Verify TypeScript can infer the return type from the implementation`,
          filesChanged: [],
        };
      }

      const inferRefactor = refactors.find((r) =>
        r.name.toLowerCase().includes('infer') || r.name.toLowerCase().includes('return')
      );

      if (!inferRefactor) {
        return {
          success: false,
          message: `Infer return type refactor not available at ${filePath}:${line}:${column}

Available refactorings: ${refactors.map(r => r.name).join(', ')}

Try a different location or use one of the available refactorings`,
          filesChanged: [],
        };
      }

      const inferAction = inferRefactor.actions.find((a: TSRefactorAction) =>
        a.description.toLowerCase().includes('infer') || a.description.toLowerCase().includes('return')
      ) || inferRefactor.actions[0];

      if (!inferAction) {
        return {
          success: false,
          message: `No infer return type action available at ${filePath}:${line}:${column}

Try:
  1. The function might already have an explicit return type
  2. Ensure the function has a return statement
  3. Verify TypeScript can analyze the function body`,
          filesChanged: [],
        };
      }

      const edits = await this.tsServer.sendRequest<TSRefactorEditInfo>('getEditsForRefactor', {
        file: filePath,
        startLine: line,
        startOffset: column,
        endLine: line,
        endOffset: column,
        refactor: inferRefactor.name,
        action: inferAction.name
      });

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: `No edits generated for infer return type at ${filePath}:${line}:${column}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure TypeScript can analyze the function's return values
  3. Verify the function body is complete and type-checkable`,
          filesChanged: [],
        };
      }

      const filesChanged: RefactorResult['filesChanged'] = [];

      for (const fileEdit of edits.edits) {
        const originalLines = await this.fileOps.readLines(fileEdit.fileName);
        const sortedChanges = this.editApplicator.sortEdits(fileEdit.textChanges);

        const fileChanges = this.editApplicator.buildFileChanges(originalLines, sortedChanges, fileEdit.fileName);
        const updatedLines = this.editApplicator.applyEdits(originalLines, sortedChanges);

        if (!validated.preview) {
          await this.fileOps.writeLines(fileEdit.fileName, updatedLines);
        }

        filesChanged.push(fileChanges);
      }

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: 'Preview: Would infer return type',
          filesChanged,
          preview: {
            filesAffected: filesChanged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      return {
        success: true,
        message: 'Inferred return type successfully',
        filesChanged,
        nextActions: [
          'organize_imports - Add any missing type imports'
        ]
      };

    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      logger.error({ err: error }, 'Infer return type failed');

      return {
        success: false,
        message: `Infer return type failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure TypeScript can parse the function
  3. Verify the function has a determinable return type`,
        filesChanged: [],
      };
    }
  }
}
