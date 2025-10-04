/**
 * Rename operation handler
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import type { TSRenameResponse, TSRenameLoc } from '../language-servers/typescript/tsserver-types.js';

export const renameSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  column: z.number().int().positive('Column must be a positive integer'),
  newName: z.string().min(1, 'New name cannot be empty')
});

export type RenameInput = z.infer<typeof renameSchema>;

export class RenameOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = renameSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(validated.filePath);

      const renameInfo = await this.tsServer.sendRequest('rename', {
        file: validated.filePath,
        line: validated.line,
        offset: validated.column,
        findInComments: false,
        findInStrings: false
      }) as TSRenameResponse | null;

      if (!renameInfo?.locs) {
        return {
          success: false,
          message: 'No rename locations found',
          filesChanged: [],
          changes: []
        };
      }

      const filesChanged: string[] = [];
      const changes: RefactorResult['changes'] = [];

      for (const fileLoc of renameInfo.locs) {
        const fileContent = await readFile(fileLoc.file, 'utf8');
        const lines = fileContent.split('\n');

        const fileChanges = {
          file: fileLoc.file.split('/').pop() || fileLoc.file,
          path: fileLoc.file,
          edits: [] as RefactorResult['changes'][0]['edits']
        };

        const edits = fileLoc.locs.sort((a: TSRenameLoc, b: TSRenameLoc) =>
          b.start.line === a.start.line ? b.start.offset - a.start.offset : b.start.line - a.start.line
        );

        for (const edit of edits) {
          const lineIndex = edit.start.line - 1;
          const line = lines[lineIndex];
          const oldText = line.substring(edit.start.offset - 1, edit.end.offset - 1);

          fileChanges.edits.push({
            line: edit.start.line,
            column: edit.start.offset,
            old: oldText,
            new: validated.newName
          });

          lines[lineIndex] =
            line.substring(0, edit.start.offset - 1) +
            validated.newName +
            line.substring(edit.end.offset - 1);
        }

        await writeFile(fileLoc.file, lines.join('\n'));
        filesChanged.push(fileLoc.file);
        changes.push(fileChanges);
      }

      return {
        success: true,
        message: `Renamed to "${validated.newName}"`,
        filesChanged,
        changes
      };
    } catch (error) {
      return {
        success: false,
        message: `Rename failed: ${error}`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Rename Symbol',
      description: '⚡ Rename across ALL files + update imports/exports automatically. TypeScript-aware renaming catches dynamic imports, re-exports, and type references that text search misses. Completes in <1s vs 5-10min manual search/replace with risk of missed references.',
      inputSchema: renameSchema.shape
    };
  }
}