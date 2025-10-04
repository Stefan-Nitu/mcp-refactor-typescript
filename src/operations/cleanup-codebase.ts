/**
 * Cleanup codebase operation - combines remove_unused + organize_imports across all files
 */

import { z } from 'zod';
import { readdir } from 'fs/promises';
import { join, extname } from 'path';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { RemoveUnusedOperation } from './remove-unused.js';
import { OrganizeImportsOperation } from './organize-imports.js';
import { formatValidationError } from '../utils/validation-error.js';

export const cleanupCodebaseSchema = z.object({
  directory: z.string().min(1, 'Directory cannot be empty'),
  preview: z.boolean().optional()
});

export type CleanupCodebaseInput = z.infer<typeof cleanupCodebaseSchema>;

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

      // Find all TypeScript files in directory
      const tsFiles = await this.findTypeScriptFiles(validated.directory);

      if (tsFiles.length === 0) {
        return {
          success: false,
          message: `❌ No TypeScript files found in ${validated.directory}

💡 Try:
  1. Check the directory path is correct
  2. Ensure directory contains .ts or .tsx files
  3. Verify you have read permissions`,
          filesChanged: [],
          changes: []
        };
      }

      const allFilesChanged: string[] = [];
      const allChanges: RefactorResult['changes'] = [];
      const steps: string[] = [];

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)
  ✓ Remove unused imports and variables
  ✓ Organize and sort imports
  ✓ Clean up code across entire codebase`,
          filesChanged: [],
          changes: [],
          preview: {
            filesAffected: tsFiles.length,
            estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      const removeOp = new RemoveUnusedOperation(this.tsServer);
      const organizeOp = new OrganizeImportsOperation(this.tsServer);

      let processedCount = 0;

      for (const file of tsFiles) {
        // Step 1: Remove unused code
        const removeResult = await removeOp.execute({ filePath: file });
        if (removeResult.success && removeResult.filesChanged.length > 0) {
          allFilesChanged.push(...removeResult.filesChanged);
          allChanges.push(...removeResult.changes);
          processedCount++;
        }

        // Step 2: Organize imports
        const organizeResult = await organizeOp.execute({ filePath: file });
        if (organizeResult.success && organizeResult.filesChanged.length > 0) {
          if (!removeResult.filesChanged.includes(file)) {
            allFilesChanged.push(...organizeResult.filesChanged);
          }
          allChanges.push(...organizeResult.changes);
        }
      }

      steps.push(`✓ Cleaned up ${processedCount} file(s)`);
      steps.push(`✓ Removed unused imports and variables`);
      steps.push(`✓ Organized imports across codebase`);

      return {
        success: true,
        message: `Cleanup completed successfully:
${steps.join('\n')}

Processed ${tsFiles.length} TypeScript file(s)`,
        filesChanged: [...new Set(allFilesChanged)],
        changes: allChanges
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }
      return {
        success: false,
        message: `❌ Cleanup codebase failed: ${error instanceof Error ? error.message : String(error)}

💡 Try:
  1. Ensure directory exists and is readable
  2. Check TypeScript project is configured
  3. Verify files can be analyzed by TypeScript`,
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
          // Skip node_modules and hidden directories
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
      description: `⚡ Clean entire codebase: remove unused code + organize imports across ALL files. Perfect for maintaining clean, organized code. Processes entire directories recursively, skipping node_modules.

Example: Cleanup src/ directory
  ✓ Removes unused imports and variables in all files
  ✓ Organizes and alphabetizes all imports
  ✓ Processes TypeScript files recursively
  ✓ Skips node_modules and hidden directories
  ✓ Complete cleanup in seconds`,
      inputSchema: cleanupCodebaseSchema.shape
    };
  }
}
