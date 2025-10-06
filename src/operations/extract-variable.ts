import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSRenameLoc, TSRenameResponse, TSTextChange } from '../language-servers/typescript/tsserver-types.js';
import { formatValidationError } from '../utils/validation-error.js';
import { Operation } from './registry.js';
import { RefactoringProcessor } from './refactoring-processor.js';

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
    private processor: RefactoringProcessor = new RefactoringProcessor('const')
  ) {}

  private detectIndentation(lines: string[], targetLine: number): string {
    // Look at surrounding lines to detect indentation
    for (let i = targetLine; i < Math.min(targetLine + 3, lines.length); i++) {
      const line = lines[i];
      if (line.trim().length > 0) {
        const match = line.match(/^(\s*)/);
        if (match) return match[1];
      }
    }
    // Look backwards if no indent found ahead
    for (let i = targetLine - 1; i >= Math.max(0, targetLine - 3); i--) {
      const line = lines[i];
      if (line.trim().length > 0) {
        const match = line.match(/^(\s*)/);
        if (match) return match[1];
      }
    }
    return '';
  }

  getSchema() {
    return {
      title: 'Extract Variable',
      description: `Extract complex expressions to local variables with type inference and your custom name. Reduces code duplication and improves readability. Auto-determines proper const/let based on usage patterns.

Example: Extract expression with custom name "doubled"
  Input: { filePath, line: 2, text: "(a + b) * 2", variableName: "doubled" }
  Output:
    const doubled = (a + b) * 2;
    return doubled;
  ✓ Custom name applied (or auto-generated if not provided)
  ✓ Type automatically inferred
  ✓ const/let determined by usage`,
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        line: z.number().int().positive('Line must be a positive integer'),
        text: z.string().min(1, 'Text cannot be empty'),
        variableName: z.string().optional()
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractVariableSchema.parse(input);
      const { filePath, line, text, variableName } = validated;

      // Convert text to column positions
      const fileContent = await readFile(filePath, 'utf8');
      const lines = fileContent.split('\n');
      const lineIndex = line - 1;

      if (lineIndex < 0 || lineIndex >= lines.length) {
        return {
          success: false,
          message: `Line ${line} is out of range (file has ${lines.length} lines)`,
          filesChanged: []
        };
      }

      const lineContent = lines[lineIndex];
      const textIndex = lineContent.indexOf(text);

      if (textIndex === -1) {
        return {
          success: false,
          message: `Text "${text}" not found on line ${line}

Line content: ${lineContent}

Try:
  1. Check the text matches exactly (case-sensitive)
  2. Ensure you're on the correct line`,
          filesChanged: []
        };
      }

      const startLine = line;
      const startColumn = textIndex + 1;
      const endLine = line;
      const endColumn = textIndex + text.length + 1;

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

          let newText = change.newText;

          // Fix indentation if this change contains a const declaration
          if (newText.includes('const ')) {
            const textLines = newText.split('\n');
            const constLineIndex = textLines.findIndex(l => l.includes('const '));

            if (constLineIndex !== -1) {
              const constLine = textLines[constLineIndex];
              const insertedIndent = constLine.match(/^(\s*)/)?.[1] || '';
              const existingIndent = this.detectIndentation(fileContent.split('\n'), startLine);

              if (insertedIndent !== existingIndent) {
                textLines[constLineIndex] = constLine.replace(/^\s*/, existingIndent);
                newText = textLines.join('\n');
              }
            }
          }

          fileChanges.edits.push({
            line: change.start.line,
            old: lines[startLine].substring(startOffset, endOffset),
            new: newText
          });

          if (startLine === endLine) {
            lines[startLine] =
              lines[startLine].substring(0, startOffset) +
              newText +
              lines[startLine].substring(endOffset);
          } else {
            const before = lines[startLine].substring(0, startOffset);
            const after = lines[endLine].substring(endOffset);
            lines.splice(startLine, endLine - startLine + 1, before + newText + after);
          }
        }

        const updatedContent = lines.join('\n');

        // Only write if not in preview mode
        if (!validated.preview) {
          await writeFile(fileEdit.fileName, updatedContent);
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

            // Update filesChanged to reflect the rename in the response
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
