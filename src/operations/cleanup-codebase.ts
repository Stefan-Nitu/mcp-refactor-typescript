/**
 * Cleanup codebase operation - uses tsr to remove unused exports + organize_imports
 */

import { exec } from 'child_process';
import { readdir } from 'fs/promises';
import { extname, join } from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import { OrganizeImportsOperation } from './organize-imports.js';

const execAsync = promisify(exec);

const cleanupCodebaseSchema = z.object({
  directory: z.string().min(1, 'Directory cannot be empty'),
  entrypoints: z
    .array(z.string())
    .optional()
    .describe(
      'Starting files your app runs from (regex patterns). Examples: ["src/main\\\\.ts$"]. Defaults to main/index/app/server files'
    ),
  preview: z.boolean().optional()
});

export class CleanupCodebaseOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = cleanupCodebaseSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      const tsFiles = await this.findTypeScriptFiles(validated.directory);

      if (tsFiles.length === 0) {
        return {
          success: false,
          message: `No TypeScript files found in ${validated.directory}

Try:
  1. Check the directory path is correct
  2. Ensure directory contains .ts or .tsx files
  3. Verify you have read permissions`,
          filesChanged: [],
          changes: []
        };
      }

      const defaultEntrypoints = 'main\\.tsx?$|index\\.tsx?$|app\\.tsx?$|server\\.tsx?$';
      const testFilePatterns = '.*\\.test\\.tsx?$|.*\\.spec\\.tsx?$|.*/__tests__/.*\\.tsx?$';
      const entrypoints =
        validated.entrypoints?.join('|') || `${defaultEntrypoints}|${testFilePatterns}`;

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)
  ✓ Remove unused exports (using tsr)
  ✓ Organize imports on changed files`,
          filesChanged: [],
          changes: [],
          preview: {
            filesAffected: tsFiles.length,
            estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      const steps: string[] = [];
      let filesChanged: string[] = [];

      try {
        await execAsync(`npx tsr --write --recursive '${entrypoints}'`, {
          cwd: validated.directory,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000
        });
        steps.push('✓ Removed unused exports (tsr)');
      } catch (error: unknown) {
        const execError = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };

        if (execError.killed) {
          return {
            success: false,
            message: 'tsr timed out after 60 seconds - project may be too large',
            filesChanged: [],
            changes: []
          };
        }

        if (execError.code === 1) {
          steps.push('✓ Removed unused exports (tsr)');
        } else {
          throw error;
        }
      }

      const organizeOp = new OrganizeImportsOperation(this.tsServer);
      let organizedCount = 0;

      for (const file of tsFiles) {
        const organizeResult = await organizeOp.execute({ filePath: file });
        if (organizeResult.success && organizeResult.filesChanged.length > 0) {
          if (!filesChanged.includes(file)) {
            filesChanged.push(file);
          }
          organizedCount++;
        }
      }

      if (organizedCount > 0) {
        steps.push(`✓ Organized imports in ${organizedCount} file(s)`);
      }

      return {
        success: true,
        message: `Cleanup completed successfully:
${steps.join('\n')}

Processed ${tsFiles.length} TypeScript file(s)`,
        filesChanged,
        changes: []
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }
      return {
        success: false,
        message: `Cleanup codebase failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure directory exists and is readable
  2. Check TypeScript project is configured
  3. Verify files can be analyzed by TypeScript
  4. Install tsr: npm install tsr`,
        filesChanged: [],
        changes: []
      };
    }
  }

  private async findTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function scan(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(directory, entry.name);

        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
            continue;
          }
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (ext === '.ts' || ext === '.tsx') {
            files.push(fullPath);
          }
        }
      }
    }

    await scan(dir);
    return files;
  }

  getSchema() {
    return {
      title: 'Cleanup Codebase',
      description: `Clean entire codebase: remove unused exports + organize imports.

What are entry points?
  Entry points are the "main" files your app starts from (like main.ts or server.ts).
  The tool follows imports from these files to find what's actually used. Everything else is removed.

Example: Cleanup src/ directory
  Input: { directory: "src" }
  ✓ Removes unused exports
  ✓ Organizes imports on changed files only
  ✓ Preserves test files automatically
  ✓ Skips node_modules and hidden directories

Entry points default to: main/index/app/server files + all test files
Customize with: { entrypoints: ["src/custom\\\\.ts$"] }

Note: Test files are automatically preserved by including them as entrypoints.`,
      inputSchema: cleanupCodebaseSchema.shape
    };
  }
}
