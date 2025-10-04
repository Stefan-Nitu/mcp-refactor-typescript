/**
 * Extract function operation handler
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorInfo, TSRefactorAction, TSTextChange, TSRefactorEditInfo } from '../language-servers/typescript/tsserver-types.js';

export const extractFunctionSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  startLine: z.number().int().positive('Start line must be a positive integer'),
  startColumn: z.number().int().positive('Start column must be a positive integer'),
  endLine: z.number().int().positive('End line must be a positive integer'),
  endColumn: z.number().int().positive('End column must be a positive integer'),
  functionName: z.string().optional()
}).refine(
  (data) => data.endLine >= data.startLine,
  { message: 'End line must be greater than or equal to start line' }
);

export type ExtractFunctionInput = z.infer<typeof extractFunctionSchema>;

export class ExtractFunctionOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = extractFunctionSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(validated.filePath);

      const refactors = await this.tsServer.sendRequest('getApplicableRefactors', {
        file: validated.filePath,
        startLine: validated.startLine,
        startOffset: validated.startColumn,
        endLine: validated.endLine,
        endOffset: validated.endColumn
      }) as TSRefactorInfo[] | null;

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: 'No refactoring available at this location',
          filesChanged: [],
          changes: []
        };
      }

      // Find extract function refactor
      const extractRefactor = refactors.find((r) =>
        r.name === 'Extract Symbol' || r.name === 'Extract function'
      );

      if (!extractRefactor) {
        return {
          success: false,
          message: 'Extract function not available at this location',
          filesChanged: [],
          changes: []
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
          message: 'No extract function action available',
          filesChanged: [],
          changes: []
        };
      }

      const edits = await this.tsServer.sendRequest<TSRefactorEditInfo>('getEditsForRefactor', {
        file: validated.filePath,
        startLine: validated.startLine,
        startOffset: validated.startColumn,
        endLine: validated.endLine,
        endOffset: validated.endColumn,
        refactor: extractRefactor.name,
        action: extractAction.name
      });

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: 'No edits returned for refactoring',
          filesChanged: [],
          changes: []
        };
      }

      const filesChanged: string[] = [];
      const changes: RefactorResult['changes'] = [];

      // Apply edits
      for (const fileEdit of edits.edits) {
        const fileContent = await readFile(fileEdit.fileName, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileEdit.fileName.split('/').pop() || fileEdit.fileName,
          path: fileEdit.fileName,
          edits: [] as RefactorResult['changes'][0]['edits']
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
        await writeFile(fileEdit.fileName, updatedContent);
        filesChanged.push(fileEdit.fileName);
        changes.push(fileChanges);
      }

      return {
        success: true,
        message: 'Extracted function',
        filesChanged,
        changes
      };
    } catch (error) {
      return {
        success: false,
        message: `Extract function failed: ${error}`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Extract Function',
      description: 'Extract selected code into a new function',
      inputSchema: {
        filePath: z.string().min(1, 'File path cannot be empty'),
        startLine: z.number().int().positive('Start line must be a positive integer'),
        startColumn: z.number().int().positive('Start column must be a positive integer'),
        endLine: z.number().int().positive('End line must be a positive integer'),
        endColumn: z.number().int().positive('End column must be a positive integer'),
        functionName: z.string().optional()
      }
    };
  }
}
