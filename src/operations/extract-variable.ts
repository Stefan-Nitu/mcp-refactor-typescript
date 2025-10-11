import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSRenameLoc, TSRenameResponse } from '../language-servers/typescript/tsserver-types.js';
import { formatValidationError } from '../utils/validation-error.js';
import { RefactoringProcessor } from './refactoring-processor.js';
import { Operation } from './registry.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';
import { IndentationDetector } from './shared/indentation-detector.js';
import { TextPositionConverter } from './shared/text-position-converter.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

const extractVariableSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty'),
  variableName: z.string().optional(),
  preview: z.boolean().optional()
});

export class ExtractVariableOperation implements Operation {
  constructor(
    private tsServer: TypeScriptServer,
    private processor: RefactoringProcessor = new RefactoringProcessor('const'),
    private fileOps: FileOperations = new FileOperations(),
    private textConverter: TextPositionConverter = new TextPositionConverter(),
    private editApplicator: EditApplicator = new EditApplicator(),
    private indentDetector: IndentationDetector = new IndentationDetector(),
    private tsServerGuard: TSServerGuard = new TSServerGuard(tsServer)
  ) {}


  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractVariableSchema.parse(input);
      const { line, text, variableName } = validated;
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

      const startLine = positionResult.startLine;
      const startColumn = positionResult.startColumn;
      const endLine = positionResult.endLine;
      const endColumn = positionResult.endColumn;

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

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
          message: `Cannot extract variable: No extractable expression at ${filePath}:${startLine}:${startColumn}-${endLine}:${endColumn}

Try:
  1. Select a valid expression or value (not a statement)
  2. Ensure the selection is syntactically complete
  3. Try selecting just the expression without surrounding code`,
          filesChanged: [],
        };
      }

      const extractRefactor = refactors.find((r) =>
        r.name === 'Extract Symbol' || r.name === 'Extract to constant'
      );

      if (!extractRefactor) {
        return {
          success: false,
          message: `Extract variable not available at this location

Available refactorings: ${refactors.map(r => r.name).join(', ')}

Try a different selection or use one of the available refactorings`,
          filesChanged: [],
        };
      }

      const variableAction = extractRefactor.actions.find((a: TSRefactorAction) =>
        a.name.startsWith('constant_scope_')
      ) || extractRefactor.actions[0];

      if (!variableAction) {
        return {
          success: false,
          message: `No extract variable action available

This might happen if:
  1. The selected code contains syntax errors
  2. The expression cannot be safely extracted
  3. The selection is not a valid extractable expression`,
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
        action: variableAction.name
      });

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: `No edits generated for extract variable

This might indicate:
  1. TypeScript LSP encountered an internal error
  2. The selection is invalid or too complex
  3. Try restarting the TypeScript server`,
          filesChanged: [],
        };
      }

      const filesChanged: RefactorResult['filesChanged'] = [];
      let generatedVariableName: string | null = null;
      let variableDeclarationLine: number | null = null;
      let variableColumn: number | null = null;

      for (const fileEdit of edits.edits) {
        const originalLines = await this.fileOps.readLines(fileEdit.fileName);
        const sortedChanges = this.editApplicator.sortEdits(fileEdit.textChanges);

        const fixedChanges = sortedChanges.map(change => {
          let newText = change.newText;

          if (newText.includes('const ')) {
            const textLines = newText.split('\n');
            const constLineIndex = textLines.findIndex(l => l.includes('const '));

            if (constLineIndex !== -1) {
              const constLine = textLines[constLineIndex];
              const insertedIndent = constLine.match(/^(\s*)/)?.[1] || '';
              const existingIndent = this.indentDetector.detect(originalLines, change.start.line - 1);

              if (insertedIndent !== existingIndent) {
                textLines[constLineIndex] = constLine.replace(/^\s*/, existingIndent);
                newText = textLines.join('\n');
              }
            }
          }

          return { ...change, newText };
        });

        const fileChanges = this.editApplicator.buildFileChanges(originalLines, fixedChanges, fileEdit.fileName);
        const updatedLines = this.editApplicator.applyEdits(originalLines, fixedChanges);

        if (!validated.preview) {
          await this.fileOps.writeLines(fileEdit.fileName, updatedLines);
        }

        filesChanged.push(fileChanges);

        if (!generatedVariableName && fileEdit.fileName === filePath) {
          const declaration = this.processor.findDeclaration(sortedChanges);
          if (declaration) {
            generatedVariableName = declaration.name;
            variableDeclarationLine = declaration.line;
            variableColumn = declaration.column;
          }
        }
      }

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would extract variable${variableName ? ` "${variableName}"` : ''}`,
          filesChanged,
          preview: {
            filesAffected: filesChanged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
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
            const originalLines = await this.fileOps.readLines(fileLoc.file);

            const renamedChanges = fileLoc.locs.map((loc: TSRenameLoc) => ({
              start: loc.start,
              end: loc.end,
              newText: variableName
            }));

            const sortedChanges = this.editApplicator.sortEdits(renamedChanges);
            const updatedLines = this.editApplicator.applyEdits(originalLines, sortedChanges);

            await this.fileOps.writeLines(fileLoc.file, updatedLines);

            this.processor.updateFilesChangedAfterRename(filesChanged, generatedVariableName, variableName, fileLoc.file);
          }
        }
      }

      return {
        success: true,
        message: `Extracted variable${variableName ? ` "${variableName}"` : ''}`,
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
        message: `Extract variable failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure the selected expression can be evaluated independently
  3. Verify the selection is within a valid scope`,
        filesChanged: [],
      };
    }
  }
}
