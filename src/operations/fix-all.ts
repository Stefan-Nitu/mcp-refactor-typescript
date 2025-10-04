/**
 * Fix all operation handler
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';

export const fixAllSchema = z.object({
  filePath: z.string()
});

export type FixAllInput = z.infer<typeof fixAllSchema>;

export class FixAllOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = fixAllSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(validated.filePath);

      const result = await this.tsServer.sendRequest('getCodeFixes', {
        file: validated.filePath,
        startLine: 1,
        startOffset: 1,
        endLine: 99999,
        endOffset: 1,
        errorCodes: []
      });

      if (!result || result.length === 0) {
        return {
          success: true,
          message: 'No fixes needed',
          filesChanged: [],
          changes: []
        };
      }

      const fileContent = await readFile(validated.filePath, 'utf8');
      let updatedContent = fileContent;

      const fileChanges = {
        file: validated.filePath.split('/').pop() || validated.filePath,
        path: validated.filePath,
        edits: [] as RefactorResult['changes'][0]['edits']
      };

      // Sort changes in reverse order
      interface Change { span: { start: number; length: number }; newText: string }
      const allChanges = (result as Array<{ changes: Array<{ textChanges: Change[] }> }>).flatMap(fix => fix.changes[0].textChanges);
      allChanges.sort((a, b) => b.span.start - a.span.start);

      for (const change of allChanges) {
        fileChanges.edits.push({
          line: 0,
          old: fileContent.substring(change.span.start, change.span.start + change.span.length),
          new: change.newText
        });

        updatedContent =
          updatedContent.substring(0, change.span.start) +
          change.newText +
          updatedContent.substring(change.span.start + change.span.length);
      }

      await writeFile(validated.filePath, updatedContent);

      return {
        success: true,
        message: `Applied ${result.length} fix(es)`,
        filesChanged: [validated.filePath],
        changes: [fileChanges]
      };
    } catch (error) {
      return {
        success: false,
        message: `Fix all failed: ${error}`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Fix All',
      description: 'Apply all available code fixes',
      inputSchema: fixAllSchema
    };
  }
}