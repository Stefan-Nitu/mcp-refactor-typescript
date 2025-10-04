import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorInfo, TSRefactorAction, TSTextChange, TSRefactorEditInfo, TSRenameResponse, TSRenameLoc } from '../language-servers/typescript/tsserver-types.js';
import { Operation } from './registry.js';
import { formatValidationError } from '../utils/validation-error.js';

export const extractVariableSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  startLine: z.number().int().positive('Start line must be a positive integer'),
  startColumn: z.number().int().nonnegative('Start column must be a non-negative integer'),
  endLine: z.number().int().positive('End line must be a positive integer'),
  endColumn: z.number().int().nonnegative('End column must be a non-negative integer'),
  variableName: z.string().optional()
});

export type ExtractVariableInput = z.infer<typeof extractVariableSchema>;

export class ExtractVariableOperation implements Operation {
  constructor(private tsServer: TypeScriptServer) {}

  getSchema() {
    return {
      title: 'Extract Variable',
      description: '⚡ Extract complex expressions to local variables with type inference and your custom name. Reduces code duplication and improves readability. Auto-determines proper const/let based on usage patterns.',
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        startLine: z.number().int().positive('Start line must be a positive integer'),
        startColumn: z.number().int().nonnegative('Start column must be a non-negative integer'),
        endLine: z.number().int().positive('End line must be a positive integer'),
        endColumn: z.number().int().nonnegative('End column must be a non-negative integer'),
        variableName: z.string().optional()
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractVariableSchema.parse(input);
      const { filePath, startLine, startColumn, endLine, endColumn, variableName } = validated;

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

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: 'Extract variable is not available at this location. Try selecting an expression or value.',
          filesChanged: [],
          changes: []
        };
      }

      const extractRefactor = refactors.find((r) =>
        r.name === 'Extract Symbol' || r.name === 'Extract to constant'
      );

      if (!extractRefactor) {
        return {
          success: false,
          message: 'Extract variable not available at this location',
          filesChanged: [],
          changes: []
        };
      }

      const variableAction = extractRefactor.actions.find((a: TSRefactorAction) =>
        a.name.startsWith('constant_scope_')
      ) || extractRefactor.actions[0];

      if (!variableAction) {
        return {
          success: false,
          message: 'No extract variable action available',
          filesChanged: [],
          changes: []
        };
      }

      const edits = await this.tsServer.sendRequest<TSRefactorEditInfo>('getEditsForRefactor', {
        file: filePath,
        startLine,
        startOffset: startColumn,
        endLine,
        endOffset: endColumn,
        refactor: extractRefactor.name,
        action: variableAction.name
      });

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: 'No edits generated for extract variable',
          filesChanged: [],
          changes: []
        };
      }

      const filesChanged: string[] = [];
      const changes: RefactorResult['changes'] = [];
      let generatedVariableName: string | null = null;
      let variableDeclarationLine: number | null = null;
      let variableColumn: number | null = null;

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

        if (!generatedVariableName && fileEdit.fileName === filePath) {
          const constMatch = updatedContent.match(/const\s+(\w+)\s*=/);
          if (constMatch) {
            generatedVariableName = constMatch[1];
            const lineIndex = updatedContent.split('\n').findIndex(line => line.includes(`const ${generatedVariableName}`));
            variableDeclarationLine = lineIndex + 1;
            const declarationLine = updatedContent.split('\n')[lineIndex];
            variableColumn = declarationLine.indexOf(generatedVariableName) + 1;
          }
        }
      }

      if (variableName && generatedVariableName && generatedVariableName !== variableName && variableDeclarationLine && variableColumn) {
        await this.tsServer.openFile(filePath);

        const renameResult = await this.tsServer.sendRequest('rename', {
          file: filePath,
          line: variableDeclarationLine,
          offset: variableColumn,
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
                variableName +
                line.substring(edit.end.offset - 1);
            }

            await writeFile(fileLoc.file, lines.join('\n'));
          }
        }
      }

      return {
        success: true,
        message: `✅ Extracted variable${variableName ? ` "${variableName}"` : ''}`,
        filesChanged,
        changes
      };

    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      return {
        success: false,
        message: `❌ Extract variable failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
        changes: []
      };
    }
  }
}
