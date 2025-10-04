import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorInfo, TSRefactorAction, TSTextChange, TSRefactorEditInfo } from '../language-servers/typescript/tsserver-types.js';
import { Operation } from './registry.js';
import { formatValidationError } from '../utils/validation-error.js';
import { logger } from '../utils/logger.js';

export const inferReturnTypeSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  column: z.number().int().positive('Column must be a positive integer')
});

export type InferReturnTypeInput = z.infer<typeof inferReturnTypeSchema>;

export class InferReturnTypeOperation implements Operation {
  constructor(private tsServer: TypeScriptServer) {}

  getSchema() {
    return {
      title: 'Infer Return Type',
      description: '⚡ Generate perfect return type annotations automatically, even for complex nested object types and union types. TypeScript compiler infers the exact type - no guessing, no mistakes. Essential for improving type safety without manual type construction.',
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        line: z.number().int().positive('Line must be a positive integer'),
        column: z.number().int().positive('Column must be a positive integer')
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = inferReturnTypeSchema.parse(input);
      const { filePath, line, column } = validated;

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

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
          message: 'Infer return type is not available at this location.',
          filesChanged: [],
          changes: []
        };
      }

      const inferRefactor = refactors.find((r) =>
        r.name.toLowerCase().includes('infer') || r.name.toLowerCase().includes('return')
      );

      if (!inferRefactor) {
        return {
          success: false,
          message: `Infer return type refactor not available. Available refactors: ${refactors.map(r => r.name).join(', ')}`,
          filesChanged: [],
          changes: []
        };
      }

      const inferAction = inferRefactor.actions.find((a: TSRefactorAction) =>
        a.description.toLowerCase().includes('infer') || a.description.toLowerCase().includes('return')
      ) || inferRefactor.actions[0];

      if (!inferAction) {
        return {
          success: false,
          message: 'No infer return type action available',
          filesChanged: [],
          changes: []
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
          message: 'No edits generated for infer return type',
          filesChanged: [],
          changes: []
        };
      }

      const filesChanged: string[] = [];
      const changes: RefactorResult['changes'] = [];

      for (const fileEdit of edits.edits) {
        const fileContent = await readFile(fileEdit.fileName, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileEdit.fileName.split('/').pop() || fileEdit.fileName,
          path: fileEdit.fileName,
          edits: [] as RefactorResult['changes'][0]['edits']
        };

        const sortedChanges = [...fileEdit.textChanges].sort((a: TSTextChange, b: TSTextChange) => {
          if (b.start.line !== a.start.line) return b.start.line - a.start.line;
          return b.start.offset - a.start.offset;
        });

        for (const change of sortedChanges) {
          const startLine = change.start.line - 1;
          const endLine = change.end.line - 1;
          const startOffset = change.start.offset - 1;
          const endOffset = change.end.offset - 1;

          fileChanges.edits.push({
            line: change.start.line,
            old: lines[startLine].substring(startOffset, endOffset),
            new: change.newText
          });

          if (startLine === endLine) {
            lines[startLine] =
              lines[startLine].substring(0, startOffset) +
              change.newText +
              lines[startLine].substring(endOffset);
          } else {
            const before = lines[startLine].substring(0, startOffset);
            const after = lines[endLine].substring(endOffset);
            lines.splice(startLine, endLine - startLine + 1, before + change.newText + after);
          }
        }

        const updatedContent = lines.join('\n');
        await writeFile(fileEdit.fileName, updatedContent);
        filesChanged.push(fileEdit.fileName);
        changes.push(fileChanges);
      }

      return {
        success: true,
        message: '✅ Inferred return type successfully',
        filesChanged,
        changes
      };

    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      logger.error({ err: error }, 'Infer return type failed');

      return {
        success: false,
        message: `❌ Infer return type failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
        changes: []
      };
    }
  }
}
