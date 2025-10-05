import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSRenameLoc, TSRenameResponse, TSTextChange } from '../language-servers/typescript/tsserver-types.js';
import { logger } from '../utils/logger.js';
import { formatValidationError } from '../utils/validation-error.js';
import { Operation } from './registry.js';

const extractConstantSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  // Simplified API: just line + text
  line: z.number().int().positive().optional(),
  text: z.string().optional(),
  // Original API: precise column positions
  startLine: z.number().int().positive().optional(),
  startColumn: z.number().int().nonnegative().optional(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().nonnegative().optional(),
  constantName: z.string().optional(),
  preview: z.boolean().optional()
}).refine(
  (data) => {
    // Must provide either (line + text) OR (startLine + startColumn + endLine + endColumn)
    const hasSimplified = data.line !== undefined && data.text !== undefined;
    const hasPrecise = data.startLine !== undefined && data.startColumn !== undefined &&
                       data.endLine !== undefined && data.endColumn !== undefined;
    return hasSimplified || hasPrecise;
  },
  {
    message: 'Must provide either (line + text) or (startLine + startColumn + endLine + endColumn)'
  }
);

export class ExtractConstantOperation implements Operation {
  constructor(private tsServer: TypeScriptServer) {}

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
    return '  '; // Default to 2 spaces
  }

  getSchema() {
    return {
      title: 'Extract Constant',
      description: `Extract magic numbers and string literals to named constants with proper scope. Auto-detects optimal scope (module/function/block) and applies your custom name. Makes code more maintainable and eliminates duplicate literal values.

Example: Extract 3.14159 with custom name "PI"
  Input: { filePath, line: 2, text: "3.14159", constantName: "PI" }
  Output:
    const PI = 3.14159;
    const area = PI * radius * radius;
  ✓ Custom name applied (or auto-generated if not provided)
  ✓ Proper scope detection
  ✓ All usages updated`,
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        line: z.number().int().positive().optional().describe('Line number where the text appears'),
        text: z.string().optional().describe('Exact text to extract from the line'),
        startLine: z.number().int().positive().optional().describe('Precise start line (alternative to line+text)'),
        startColumn: z.number().int().nonnegative().optional().describe('Precise start column'),
        endLine: z.number().int().positive().optional().describe('Precise end line'),
        endColumn: z.number().int().nonnegative().optional().describe('Precise end column'),
        constantName: z.string().optional()
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractConstantSchema.parse(input);
      let { filePath, startLine, startColumn, endLine, endColumn, constantName } = validated;

      // Handle simplified API: convert line + text to column positions
      if (validated.line !== undefined && validated.text !== undefined) {
        const fileContent = await readFile(validated.filePath, 'utf8');
        const lines = fileContent.split('\n');
        const lineIndex = validated.line - 1;

        if (lineIndex < 0 || lineIndex >= lines.length) {
          return {
            success: false,
            message: `Line ${validated.line} is out of range (file has ${lines.length} lines)`,
            filesChanged: []
          };
        }

        const lineContent = lines[lineIndex];
        const textIndex = lineContent.indexOf(validated.text);

        if (textIndex === -1) {
          return {
            success: false,
            message: `Text "${validated.text}" not found on line ${validated.line}

Line content: ${lineContent}

Try:
  1. Check the text matches exactly (case-sensitive)
  2. Ensure you're on the correct line
  3. Use the precise column API if the text appears multiple times`,
            filesChanged: []
          };
        }

        // Convert to TypeScript column positions (1-indexed)
        startLine = validated.line;
        startColumn = textIndex + 1;
        endLine = validated.line;
        endColumn = textIndex + validated.text.length + 1;
      }

      // Type guard: ensure all required params are defined
      if (startLine === undefined || startColumn === undefined ||
          endLine === undefined || endColumn === undefined) {
        return {
          success: false,
          message: 'Internal error: column positions not properly set',
          filesChanged: []
        };
      }

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

          let newText = change.newText;

          // Fix indentation if this change contains a const declaration
          // TypeScript might insert it with wrong indentation
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
