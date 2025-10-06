/**
 * Extract function operation handler
 */

import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSRenameLoc, TSRenameResponse, TSTextChange } from '../language-servers/typescript/tsserver-types.js';
import { RefactoringProcessor } from './refactoring-processor.js';

export const extractFunctionSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive().optional(),
  text: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  startColumn: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
  functionName: z.string().optional(),
  preview: z.boolean().optional()
}).refine(
  (data) => {
    const hasSimplified = data.line !== undefined && data.text !== undefined;
    const hasPrecise = data.startLine !== undefined && data.startColumn !== undefined &&
                       data.endLine !== undefined && data.endColumn !== undefined;
    if (!hasSimplified && !hasPrecise) {
      return false;
    }
    if (hasPrecise && data.endLine! < data.startLine!) {
      return false;
    }
    return true;
  },
  {
    message: 'Must provide either (line + text) or (startLine + startColumn + endLine + endColumn), and endLine >= startLine'
  }
);

export class ExtractFunctionOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private processor: RefactoringProcessor = new RefactoringProcessor('function')
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractFunctionSchema.parse(input);
      let { startLine, startColumn, endLine, endColumn } = validated;

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

        startLine = validated.line;
        startColumn = textIndex + 1;
        endLine = validated.line;
        endColumn = textIndex + validated.text.length + 1;
      }

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

      await this.tsServer.openFile(validated.filePath);

      const refactors = await this.tsServer.sendRequest('getApplicableRefactors', {
        file: validated.filePath,
        startLine,
        startOffset: startColumn,
        endLine,
        endOffset: endColumn
      }) as TSRefactorInfo[] | null;

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: `Cannot extract function: No extractable code at ${validated.filePath}:${validated.startLine}:${validated.startColumn}-${validated.endLine}:${validated.endColumn}

Try:
  1. Select a valid statement or expression (not just whitespace)
  2. Ensure the selection is complete and syntactically valid
  3. Try selecting a larger or smaller code block`,
          filesChanged: [],
        };
      }

      // Find extract function refactor
      const extractRefactor = refactors.find((r) =>
        r.name === 'Extract Symbol' || r.name === 'Extract function'
      );

      if (!extractRefactor) {
        return {
          success: false,
          message: `Extract function not available at this location

Available refactorings: ${refactors.map(r => r.name).join(', ')}

Try a different selection or use one of the available refactorings`,
          filesChanged: [],
        };
      }

      // Find the specific action (prefer "Extract to function in module scope")
      const extractAction = extractRefactor.actions.find((a: TSRefactorAction) =>
        a.description.includes('function in module scope') ||
        a.description.includes('Extract to function')
      ) || extractRefactor.actions[0];

      if (!extractAction) {
        return {
          success: false,
          message: `No extract function action available

This might happen if:
  1. The code has syntax errors
  2. The selection contains only declarations
  3. The selected code cannot be extracted safely`,
          filesChanged: [],
        };
      }

      const edits = await this.tsServer.sendRequest<TSRefactorEditInfo>('getEditsForRefactor', {
        file: validated.filePath,
        startLine,
        startOffset: startColumn,
        endLine,
        endOffset: endColumn,
        refactor: extractRefactor.name,
        action: extractAction.name
      });

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: `No edits generated for extract function

This might indicate:
  1. TypeScript LSP encountered an internal error
  2. The selection is invalid or too complex
  3. Try restarting the TypeScript server`,
          filesChanged: [],
        };
      }

      const filesChanged: RefactorResult['filesChanged'] = [];
      let generatedFunctionName: string | null = null;

      // Apply edits
      for (const fileEdit of edits.edits) {
        const fileContent = await readFile(fileEdit.fileName, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileEdit.fileName.split('/').pop() || fileEdit.fileName,
          path: fileEdit.fileName,
          edits: [] as RefactorResult['filesChanged'][0]['edits']
        };

        // Sort changes in reverse order
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

        if (!generatedFunctionName && fileEdit.fileName === validated.filePath) {
          const declaration = this.processor.findDeclaration(sortedChanges);
          if (declaration) {
            generatedFunctionName = declaration.name;
          }
        }
      }

      // Return preview if requested
      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would extract function${validated.functionName ? ` "${validated.functionName}"` : ''}`,
          filesChanged,
          preview: {
            filesAffected: filesChanged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      if (validated.functionName && generatedFunctionName && generatedFunctionName !== validated.functionName) {
        // Re-read file to find function location after edits were applied
        const updatedFileContent = await readFile(validated.filePath, 'utf8');
        const updatedLines = updatedFileContent.split('\n');

        // Find the function declaration in the updated file
        let functionLine: number | null = null;
        let functionColumn: number | null = null;

        for (let i = 0; i < updatedLines.length; i++) {
          const line = updatedLines[i];
          const match = line.match(new RegExp(`function\\s+${generatedFunctionName}\\s*\\(`));
          if (match) {
            functionLine = i + 1; // 1-indexed
            functionColumn = line.indexOf(generatedFunctionName) + 1; // 1-indexed
            break;
          }
        }

        if (!functionLine || !functionColumn) {
          // Function not found in updated file - skip rename
          return {
            success: true,
            message: 'Extracted function',
            filesChanged,
            nextActions: [
              'organize_imports - Clean up imports if needed',
              'infer_return_type - Add explicit return type to the extracted function'
            ]
          };
        }

        await this.tsServer.openFile(validated.filePath);

        const renameResult = await this.tsServer.sendRequest('rename', {
          file: validated.filePath,
          line: functionLine,
          offset: functionColumn,
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
                validated.functionName +
                line.substring(edit.end.offset - 1);
            }

            await writeFile(fileLoc.file, lines.join('\n'));

            // Update filesChanged to reflect the rename in the response
            this.processor.updateFilesChangedAfterRename(filesChanged, generatedFunctionName, validated.functionName, fileLoc.file);
          }
        }
      }

      return {
        success: true,
        message: 'Extracted function',
        filesChanged,
        nextActions: [
          'organize_imports - Clean up imports if needed',
          'infer_return_type - Add explicit return type to the extracted function'
        ]
      };
    } catch (error) {
      return {
        success: false,
        message: `Extract function failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure TypeScript can parse the selected code
  3. Verify the selection doesn't span multiple scopes incorrectly`,
        filesChanged: [],
      };
    }
  }

  getSchema() {
    return {
      title: 'Extract Function',
      description: `Extract code blocks into functions with auto-detected parameters, return types, dependencies, and your custom name. TypeScript analyzes data flow to determine what needs to be passed in vs returned. Impossible to do correctly by hand - would require manual analysis of closures, mutations, and control flow.

Example: Extract "const result = x + y;" with name "addNumbers"
  Input: { filePath, line: 2, text: "x + y", functionName: "addNumbers" }
  Output:
    function addNumbers() { return x + y; }
    const result = addNumbers();
  ✓ Auto-detects parameters needed (x, y)
  ✓ Infers return type
  ✓ Applies custom name
  ✓ Replaces selection with function call`,
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        line: z.number().int().positive().optional().describe('Line number where the text appears'),
        text: z.string().optional().describe('Exact text to extract from the line'),
        startLine: z.number().int().positive().optional().describe('Precise start line (alternative to line+text)'),
        startColumn: z.number().int().nonnegative().optional().describe('Precise start column'),
        endLine: z.number().int().positive().optional().describe('Precise end line'),
        endColumn: z.number().int().nonnegative().optional().describe('Precise end column'),
        functionName: z.string().optional()
      }
    };
  }
}
