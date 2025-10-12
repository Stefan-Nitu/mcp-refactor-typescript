/**
 * Extract function operation handler
 */

import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSRenameLoc, TSRenameResponse } from '../language-servers/typescript/tsserver-types.js';
import { RefactoringProcessor } from './refactoring-processor.js';
import { EditApplicator } from './shared/edit-applicator.js';
import { FileOperations } from './shared/file-operations.js';
import { TextPositionConverter } from './shared/text-position-converter.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const extractFunctionSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty'),
  name: z.string().optional(),
  preview: z.boolean().optional()
});

export class ExtractFunctionOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private processor: RefactoringProcessor,
    private fileOps: FileOperations,
    private textConverter: TextPositionConverter,
    private editApplicator: EditApplicator,
    private tsServerGuard: TSServerGuard
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractFunctionSchema.parse(input);
      const { line, text, name: functionName } = validated;
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
        endOffset: endColumn
      }) as TSRefactorInfo[] | null;

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: `Cannot extract function: No extractable code for "${text}" at ${filePath}:${line}

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
        file: filePath,
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
        const originalLines = await this.fileOps.readLines(fileEdit.fileName);
        const sortedChanges = this.editApplicator.sortEdits(fileEdit.textChanges);
        const fileChanges = this.editApplicator.buildFileChanges(originalLines, sortedChanges, fileEdit.fileName);
        const updatedLines = this.editApplicator.applyEdits(originalLines, sortedChanges);

        if (!validated.preview) {
          await this.fileOps.writeLines(fileEdit.fileName, updatedLines);
        }

        filesChanged.push(fileChanges);

        if (!generatedFunctionName && fileEdit.fileName === filePath) {
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
          message: `Preview: Would extract function${functionName ? ` "${functionName}"` : ''}`,
          filesChanged,
          preview: {
            filesAffected: filesChanged.length,
            estimatedTime: '< 1s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      if (functionName && generatedFunctionName && generatedFunctionName !== functionName) {
        // Re-read file to find function location after edits were applied
        const updatedLines = await this.fileOps.readLines(filePath);

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

        await this.tsServer.openFile(filePath);

        const renameResult = await this.tsServer.sendRequest('rename', {
          file: filePath,
          line: functionLine,
          offset: functionColumn,
          findInComments: false,
          findInStrings: false
        }) as TSRenameResponse | null;

        if (renameResult?.locs) {
          for (const fileLoc of renameResult.locs) {
            const originalLines = await this.fileOps.readLines(fileLoc.file);

            const renamedChanges = fileLoc.locs.map((loc: TSRenameLoc) => ({
              start: loc.start,
              end: loc.end,
              newText: functionName
            }));

            const sortedChanges = this.editApplicator.sortEdits(renamedChanges);
            const updatedLines = this.editApplicator.applyEdits(originalLines, sortedChanges);

            await this.fileOps.writeLines(fileLoc.file, updatedLines);

            this.processor.updateFilesChangedAfterRename(filesChanged, generatedFunctionName, functionName, fileLoc.file);
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

}
