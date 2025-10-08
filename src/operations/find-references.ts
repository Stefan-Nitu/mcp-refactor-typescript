/**
 * Find references operation handler
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import type { TSReferenceEntry, TSReferencesResponse } from '../language-servers/typescript/tsserver-types.js';

export const findReferencesSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  line: z.number().int().positive('Line must be a positive integer'),
  text: z.string().min(1, 'Text cannot be empty')
});

export class FindReferencesOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = findReferencesSchema.parse(input);
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

      const column = textIndex + 1;

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      await this.tsServer.openFile(filePath);

      try {
        await this.tsServer.discoverAndOpenImportingFiles(filePath);
      } catch {
        // Continue if file discovery fails
      }

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

  getSchema() {
    return {
      title: 'Find References',
      description: `Find ALL usages with type-aware analysis. Catches dynamic imports, CommonJS requires, re-exports, type-only imports, and JSDoc references that text search (grep/ripgrep) completely misses. Essential for understanding impact before refactoring.

Example: Find references to 'helper' function
  Input:
    utils.ts: export function helper() { return 42; }
    main.ts: const result = helper(); const another = helper();
  Output:
    Found 3 reference(s) in 2 file(s):
    utils.ts: Line 1: export function helper()...
    main.ts: Line 1: const result = helper();
    main.ts: Line 2: const another = helper();
  ✓ Includes declaration + all usages
  ✓ Type-aware (not just text search)`,
      inputSchema: findReferencesSchema.shape
    };
  }
}