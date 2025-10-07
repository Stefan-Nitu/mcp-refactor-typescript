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
  deleteUnusedFiles: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Delete files with no used exports (default: false). When false, only removes unused exports within files.'
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
          filesChanged: []
        };
      }

      const defaultEntrypoints = 'main\\.tsx?$|index\\.tsx?$|app\\.tsx?$|server\\.tsx?$';
      const testFilePatterns = '.*\\.test\\.tsx?$|.*\\.spec\\.tsx?$|.*/__tests__/.*\\.tsx?$';
      const entrypoints =
        validated.entrypoints?.join('|') || `${defaultEntrypoints}|${testFilePatterns}`;

      if (validated.preview) {
        if (validated.deleteUnusedFiles) {
          try {
            const result = await execAsync(`npx tsr --recursive '${entrypoints}'`, {
              cwd: validated.directory,
              maxBuffer: 10 * 1024 * 1024,
              timeout: 60000
            });

            const output = result.stdout || '';
            const lines = output.trim().split('\n').filter(l => l.trim().length > 0);

            let previewMessage = `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)\n\n`;

            if (lines.length === 0 || output.includes('No unused')) {
              previewMessage += 'No unused exports or files found!\n- All exports are used\n- No files would be deleted';
            } else {
              previewMessage += `TSR would make changes:\n${lines.slice(0, 20).join('\n')}`;
              if (lines.length > 20) {
                previewMessage += `\n... and ${lines.length - 20} more changes`;
              }
              previewMessage += '\n\nWill also organize imports in affected files';
            }

            return {
              success: true,
              message: previewMessage,
              filesChanged: [],
              preview: {
                filesAffected: lines.length,
                estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
                command: 'Run again with preview: false to apply changes'
              }
            };
          } catch (error: unknown) {
            const execError = error as { code?: number; stdout?: string; stderr?: string };

            // tsr exits with code 1 when it finds changes, which is expected
            if (execError.code === 1 && (execError.stderr || execError.stdout)) {
              const output = execError.stderr || execError.stdout || '';
              const lines = output.trim().split('\n').filter(l => l.trim().length > 0);

              let previewMessage = `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)\n\n`;

              if (output.includes('No unused')) {
                previewMessage += 'No unused exports or files found!\n- All exports are used\n- No files would be deleted';
              } else {
                previewMessage += `TSR would make changes:\n${lines.slice(0, 20).join('\n')}`;
                if (lines.length > 20) {
                  previewMessage += `\n... and ${lines.length - 20} more changes`;
                }
                previewMessage += '\n\nWill also organize imports in affected files';
              }

              return {
                success: true,
                message: previewMessage,
                filesChanged: [],
                preview: {
                  filesAffected: lines.length,
                  estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
                  command: 'Run again with preview: false to apply changes'
                }
              };
            }

            return {
              success: false,
              message: `Preview failed: ${execError.stderr || execError.stdout || 'tsr error'}\n\nTry:\n  1. Ensure tsr is installed (npm install tsr)\n  2. Check tsconfig.json is valid\n  3. Verify entry point patterns match files`,
              filesChanged: []
            };
          }
        } else {
          return {
            success: true,
            message: `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)\n\nOrganize imports only\nTo remove unused exports/files, set deleteUnusedFiles: true`,
            filesChanged: [],
            preview: {
              filesAffected: tsFiles.length,
              estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
              command: 'Run again with preview: false to apply changes'
            }
          };
        }
      }

      const steps: string[] = [];
      const filesChanged: RefactorResult['filesChanged'] = [];

      // Only run tsr if deleteUnusedFiles is true
      if (validated.deleteUnusedFiles) {
        try {
          await execAsync(`npx tsr --write --recursive '${entrypoints}'`, {
            cwd: validated.directory,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000
          });
          steps.push('Removed unused exports and files (tsr)');
        } catch (error: unknown) {
          const execError = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };

          if (execError.killed) {
            return {
              success: false,
              message: 'tsr timed out after 60 seconds - project may be too large',
              filesChanged: []
            };
          }

          if (execError.code === 1) {
            steps.push('Removed unused exports and files (tsr)');
          } else {
            throw error;
          }
        }
      } else {
        steps.push('Skipped unused export removal (deleteUnusedFiles: false)');
      }

      const organizeOp = new OrganizeImportsOperation(this.tsServer);

      for (const file of tsFiles) {
        const organizeResult = await organizeOp.execute({ filePath: file });
        if (organizeResult.success && organizeResult.filesChanged.length > 0) {
          filesChanged.push(...organizeResult.filesChanged);
        }
      }

      if (filesChanged.length > 0) {
        steps.push(`✓ Organized imports in ${filesChanged.length} file(s)`);
      }

      return {
        success: true,
        message: `Cleanup completed successfully:
${steps.join('\n')}

Processed ${tsFiles.length} TypeScript file(s)`,
        filesChanged
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
        filesChanged: []
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
      description: `Clean entire codebase: organize imports and optionally remove unused exports/files.

Safety First (Default Behavior):
  By default, only organizes imports WITHOUT deleting files or exports.
  Set deleteUnusedFiles: true for aggressive cleanup.

What are entry points?
  Entry points are the "main" files your app starts from (like main.ts or server.ts).
  When deleteUnusedFiles is true, the tool follows imports from these files to find what's actually used.

Example: Safe cleanup (organizes imports only)
  Input: { directory: "src" }
  - Organizes imports in all files
  - Preserves all files and exports
  - Skips node_modules and hidden directories

Example: Aggressive cleanup (removes unused code)
  Input: { directory: "src", deleteUnusedFiles: true }
  - Removes unused exports using tsr
  - Deletes files with no used exports
  - Organizes imports in remaining files
  WARNING: This will delete files! Use preview mode first.

Entry points default to: main/index/app/server files + all test files
Customize with: { entrypoints: ["src/custom\\\\.ts$"] }

Note: Test files are automatically preserved by including them as entrypoints.`,
      inputSchema: cleanupCodebaseSchema.shape
    };
  }
}
