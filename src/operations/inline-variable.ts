import { resolve } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSRefactorAction, TSRefactorEditInfo, TSRefactorInfo, TSTextChange } from '../language-servers/typescript/tsserver-types.js';
import { logger } from '../utils/logger.js';
import { formatValidationError } from '../utils/validation-error.js';
import { Operation } from './registry.js';

export const inlineVariableSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty'),
  preview: z.boolean().optional()
});

export class InlineVariableOperation implements Operation {
  constructor(private tsServer: TypeScriptServer) {}

  getSchema() {
    return {
      title: 'Inline Variable',
      description: `Inline variables into usages while preserving types and handling scope correctly. Type-aware inlining avoids type narrowing bugs and scope issues that manual inlining causes. Safely handles multiple usages, complex expressions, and edge cases.

Example: Inline const multiplier
  Input:
    const multiplier = 2;
    return 5 * multiplier;
  Output:
    return 5 * 2;
  ✓ Replaces all usages
  ✓ Removes variable declaration
  ✓ Preserves type safety`,
      inputSchema: inlineVariableSchema.shape
    };
  }

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = inlineVariableSchema.parse(input);
      const filePath = resolve(validated.filePath);

      // Convert text to column position
      const fileContent = await readFile(filePath, 'utf8');
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
  2. Ensure you're on the correct line`,
          filesChanged: []
        };
      }

      const line = validated.line;
      const column = textIndex + 1;

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
        kind: 'refactor.inline'
      }) as TSRefactorInfo[] | null;

      logger.debug({ refactors }, 'Available refactorings');

      if (!refactors || refactors.length === 0) {
        return {
          success: false,
          message: `Cannot inline variable: No inlinable variable at ${filePath}:${line}:${column}

Try:
  1. Place cursor on a variable name (in declaration or usage)
  2. Ensure the variable has a simple value that can be inlined
  3. Verify the variable is only used in the same scope`,
          filesChanged: [],
        };
      }

      const inlineRefactor = refactors.find((r) =>
        r.name.toLowerCase().includes('inline')
      );

      if (!inlineRefactor) {
        return {
          success: false,
          message: `Inline refactor not available at ${filePath}:${line}:${column}

Available refactorings: ${refactors.map(r => r.name).join(', ')}

Try a different location or use one of the available refactorings`,
          filesChanged: [],
        };
      }

      const inlineAction = inlineRefactor.actions.find((a: TSRefactorAction) =>
        a.description.toLowerCase().includes('inline')
      ) || inlineRefactor.actions[0];

      if (!inlineAction) {
        return {
          success: false,
          message: `No inline action available at ${filePath}:${line}:${column}

Try:
  1. The variable might have side effects that prevent inlining
  2. Check if the variable is used multiple times in different scopes
  3. Ensure the variable's value is simple enough to inline`,
          filesChanged: [],
        };
      }

      const edits = await this.tsServer.sendRequest<TSRefactorEditInfo>('getEditsForRefactor', {
        file: filePath,
        startLine: line,
        startOffset: column,
        endLine: line,
        endOffset: column,
        refactor: inlineRefactor.name,
        action: inlineAction.name
      });

      if (!edits || !edits.edits || edits.edits.length === 0) {
        return {
          success: false,
          message: `No edits generated for inline variable at ${filePath}:${line}:${column}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure the variable can be safely inlined
  3. Verify there are no circular dependencies`,
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
          message: 'Preview: Would inline variable',
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
        message: 'Inlined variable successfully',
        filesChanged,
        nextActions: [
          'remove_unused - Clean up any unused imports'
        ]
      };

    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      logger.error({ err: error }, 'Inline variable failed');

      return {
        success: false,
        message: `Inline variable failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Check that the file is saved and syntactically valid
  2. Ensure TypeScript can parse the code
  3. Verify the variable can be safely inlined without side effects`,
        filesChanged: [],
      };
    }
  }
}
