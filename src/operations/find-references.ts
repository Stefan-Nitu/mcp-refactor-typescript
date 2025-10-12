/**
 * Find references operation handler
 */

import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSReferenceEntry, TSReferencesResponse } from '../language-servers/typescript/tsserver-types.js';
import { FileDiscovery } from './shared/file-discovery.js';
import { FileOperations } from './shared/file-operations.js';
import { TextPositionConverter } from './shared/text-position-converter.js';
import { TSServerGuard } from './shared/tsserver-guard.js';

export const findReferencesSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty')
});

export class FindReferencesOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private textConverter: TextPositionConverter,
    private tsServerGuard: TSServerGuard,
    private fileDiscovery: FileDiscovery
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = findReferencesSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const lines = await this.fileOps.readLines(filePath);
      const positionResult = this.textConverter.findTextPosition(lines, validated.line, validated.text);

      if (!positionResult.success) {
        return {
          success: false,
          message: positionResult.message,
          filesChanged: []
        };
      }

      const column = positionResult.startColumn;

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.fileDiscovery.discoverRelatedFiles(filePath);

      const references = await this.tsServer.sendRequest<TSReferencesResponse>('references', {
        file: filePath,
        line: validated.line,
        offset: column
      });

      if (!references?.refs || references.refs.length === 0) {
        return {
          success: true,
          message: 'No references found',
          filesChanged: [],
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
        message += `\n${fileName}:\n`;
        for (const ref of refs) {
          message += `  • Line ${ref.start.line}: ${ref.lineText.trim()}\n`;
        }
      }

      return {
        success: true,
        message,
        filesChanged: [],
      };
    } catch (error) {
      return {
        success: false,
        message: `Find references failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check the position points to a valid symbol
  3. Verify TypeScript project is configured correctly`,
        filesChanged: [],
      };
    }
  }

}
