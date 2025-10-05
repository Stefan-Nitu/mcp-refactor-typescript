import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSTextChange } from '../language-servers/typescript/tsserver-types.js';
import { logger } from '../utils/logger.js';
import { formatValidationError } from '../utils/validation-error.js';
import { Operation } from './registry.js';

const inferReturnTypeSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  column: z.number().int().positive('Column must be a positive integer'),
  preview: z.boolean().optional()
});

export class InferReturnTypeOperation implements Operation {
  constructor(private tsServer: TypeScriptServer) {}

  getSchema() {
    return {
      title: 'Infer Return Type',
      description: `Generate perfect return type annotations automatically, even for complex nested object types and union types. TypeScript compiler infers the exact type - no guessing, no mistakes. Essential for improving type safety without manual type construction.

Example: Add return type to function
  Input:
    function add(a: number, b: number) {
      return a + b;
    }
  Output:
    function add(a: number, b: number): number {
      return a + b;
    }
  ✓ Infers exact type (works for complex objects too)
  ✓ Adds annotation automatically
  ✓ No manual type writing needed`,
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
        const fileContent = await readFile(fileEdit.fileName, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileEdit.fileName.split('/').pop() || fileEdit.fileName,
          path: fileEdit.fileName,
          edits: [] as RefactorResult['filesChanged'][0]['edits']
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

        // Only write if not in preview mode
        if (!validated.preview) {
          await writeFile(fileEdit.fileName, updatedContent);
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
