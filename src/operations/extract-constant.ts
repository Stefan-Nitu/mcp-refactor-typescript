import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSRenameLoc, TSRenameResponse, TSTextChange } from '../language-servers/typescript/tsserver-types.js';
import { logger } from '../utils/logger.js';
import { formatValidationError } from '../utils/validation-error.js';
import { Operation } from './registry.js';

const extractConstantSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  startLine: z.number().int().positive('Start line must be a positive integer'),
  startColumn: z.number().int().nonnegative('Start column must be a non-negative integer'),
  endLine: z.number().int().positive('End line must be a positive integer'),
  endColumn: z.number().int().nonnegative('End column must be a non-negative integer'),
  constantName: z.string().optional(),
  preview: z.boolean().optional()
});

export class ExtractConstantOperation implements Operation {
  constructor(private tsServer: TypeScriptServer) {}

  getSchema() {
    return {
      title: 'Extract Constant',
      description: `Extract magic numbers and string literals to named constants with proper scope. Auto-detects optimal scope (module/function/block) and applies your custom name. Makes code more maintainable and eliminates duplicate literal values.

Example: Extract 3.14159 with custom name "PI"
  Input:
    const area = 3.14159 * radius * radius;
  Output:
    const PI = 3.14159;
    const area = PI * radius * radius;
  ✓ Custom name applied (or auto-generated if not provided)
  ✓ Proper scope detection
  ✓ All usages updated`,
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        startLine: z.number().int().positive('Start line must be a positive integer'),
        startColumn: z.number().int().nonnegative('Start column must be a non-negative integer'),
        endLine: z.number().int().positive('End line must be a positive integer'),
        endColumn: z.number().int().nonnegative('End column must be a non-negative integer'),
        constantName: z.string().optional()
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractConstantSchema.parse(input);
      const { filePath, startLine, startColumn, endLine, endColumn, constantName } = validated;

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(filePath);

      const refactors = await this.tsServer.sendRequest('getApplicableRefactors', {
        file: filePath,
        startLine,
        startOffset: startColumn,
        endLine,
        endOffset: endColumn,
        triggerReason: 'invoked',
        kind: 'refactor.extract.constant'
      }) as TSRefactorInfo[] | null;

      logger.debug({ refactors }, 'Available refactorings');

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: `Cannot extract constant: No extractable value at ${filePath}:${startLine}:${startColumn}

Try:
  1. Select a literal value (number, string, or boolean)
  2. Select a simple expression that can be made constant
  3. Ensure the selection is syntactically valid`,
          filesChanged: [],
        };
      }

      const extractRefactor = refactors.find((r) =>
        r.name === 'Extract Symbol' || r.name === 'Extract to constant'
      );

      if (!extractRefactor) {
        return {
          success: false,
          message: `Extract constant not available at ${filePath}:${startLine}:${startColumn}

Available refactorings: ${refactors.map(r => r.name).join(', ')}

Try a different selection or use one of the available refactorings`,
          filesChanged: [],
        };
      }

      logger.info({ actions: extractRefactor.actions }, 'Available extract actions');

      const constantAction = extractRefactor.actions.find((a: TSRefactorAction) =>
        a.name.startsWith('constant_scope_') ||
        a.description?.toLowerCase().includes('constant') ||
        a.description?.toLowerCase().includes('enclosing')
      );

      if (!constantAction) {
        const actionDetails = extractRefactor.actions.map((a: TSRefactorAction) =>
          `${a.name} (${a.description})`
        ).join(', ');
        return {
          success: false,
          message: `No constant action available at ${filePath}:${startLine}:${startColumn}

Try:
  1. Place cursor on a variable or constant declaration
  2. Ensure the value is eligible for extraction
  3. Available actions: ${actionDetails}`,
          filesChanged: [],
        };
      }

      const edits = await this.tsServer.sendRequest<TSRefactorEditInfo>('getEditsForRefactor', {
        file: filePath,
        startLine,
        startOffset: startColumn,
        endLine,
        endOffset: endColumn,
        refactor: extractRefactor.name,
        action: constantAction.name
      });

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: `No edits generated for extract constant at ${filePath}:${startLine}:${startColumn}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure TypeScript can parse the selected value
  3. Verify the selection is a valid expression`,
          filesChanged: [],
        };
      }

      const filesChanged: RefactorResult['filesChanged'] = [];
      let generatedConstantName: string | null = null;
      let constantDeclarationLine: number | null = null;
      let constantColumn: number | null = null;

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

        if (!generatedConstantName && fileEdit.fileName === filePath) {
          const constMatch = updatedContent.match(/const\s+(\w+)\s*=/);
          if (constMatch) {
            generatedConstantName = constMatch[1];
            const lineIndex = updatedContent.split('\n').findIndex(line => line.includes(`const ${generatedConstantName}`));
            constantDeclarationLine = lineIndex + 1;
            const declarationLine = updatedContent.split('\n')[lineIndex];
            constantColumn = declarationLine.indexOf(generatedConstantName) + 1;
          }
        }
      }

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would extract constant${constantName ? ` "${constantName}"` : ''}`,
          filesChanged,
          preview: {
            filesAffected: filesChanged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      if (constantName && generatedConstantName && generatedConstantName !== constantName && constantDeclarationLine && constantColumn) {
        await this.tsServer.openFile(filePath);

        const renameResult = await this.tsServer.sendRequest('rename', {
          file: filePath,
          line: constantDeclarationLine,
          offset: constantColumn,
          findInComments: false,
          findInStrings: false
        }) as TSRenameResponse | null;

        if (renameResult?.locs) {
          for (const fileLoc of renameResult.locs) {
            const fileContent = await readFile(fileLoc.file, 'utf8');
            const lines = fileContent.split('\n');

            const edits = fileLoc.locs.sort((a: TSRenameLoc, b: TSRenameLoc) =>
              b.start.line === a.start.line ? b.start.offset - a.start.offset : b.start.line - a.start.line
            );

            for (const edit of edits) {
              const lineIndex = edit.start.line - 1;
              const line = lines[lineIndex];
              lines[lineIndex] =
                line.substring(0, edit.start.offset - 1) +
                constantName +
                line.substring(edit.end.offset - 1);
            }

            await writeFile(fileLoc.file, lines.join('\n'));
          }
        }
      }

      return {
        success: true,
        message: `Extracted constant${constantName ? ` "${constantName}"` : ''}`,
        filesChanged,
        nextActions: [
          'organize_imports - Clean up imports if needed'
        ]
      };

    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      return {
        success: false,
        message: `Extract constant failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure TypeScript can parse the selected value
  3. Verify the selection is a complete expression or literal`,
        filesChanged: [],
      };
    }
  }
}
