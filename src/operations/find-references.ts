/**
 * Find references operation handler
 */

import { z } from 'zod';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import type { TSReferencesResponse, TSReferenceEntry } from '../language-servers/typescript/tsserver-types.js';

export const findReferencesSchema = z.object({
  filePath: z.string(),
  line: z.number(),
  column: z.number()
});

export type FindReferencesInput = z.infer<typeof findReferencesSchema>;

export class FindReferencesOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = findReferencesSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(validated.filePath);

      const references = await this.tsServer.sendRequest<TSReferencesResponse>('references', {
        file: validated.filePath,
        line: validated.line,
        offset: validated.column
      });

      if (!references?.refs || references.refs.length === 0) {
        return {
          success: true,
          message: 'No references found',
          filesChanged: [],
          changes: []
        };
      }

      const fileGroups = new Map<string, TSReferenceEntry[]>();

      for (const ref of references.refs) {
        if (!fileGroups.has(ref.file)) {
          fileGroups.set(ref.file, []);
        }
        fileGroups.get(ref.file)!.push(ref);
      }

      let message = `Found ${references.refs.length} reference(s) in ${fileGroups.size} file(s):\n`;

      for (const [file, refs] of fileGroups) {
        const fileName = file.split('/').pop() || file;
        message += `\n📄 ${fileName}:\n`;
        for (const ref of refs) {
          message += `  • Line ${ref.start.line}: ${ref.lineText.trim()}\n`;
        }
      }

      return {
        success: true,
        message,
        filesChanged: [],
        changes: []
      };
    } catch (error) {
      return {
        success: false,
        message: `Find references failed: ${error}`,
        filesChanged: [],
        changes: []
      };
    }
  }

  getSchema() {
    return {
      title: 'Find References',
      description: 'Find all references to a symbol',
      inputSchema: findReferencesSchema.shape
    };
  }
}