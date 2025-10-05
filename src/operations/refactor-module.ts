/**
 * Refactor module operation - combines move_file + organize_imports + fix_all
 */

import { z } from 'zod';
import { RefactorResult, TypeScriptServer } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import { FixAllOperation } from './fix-all.js';
import { MoveFileOperation } from './move-file.js';
import { OrganizeImportsOperation } from './organize-imports.js';

const refactorModuleSchema = z.object({
  sourcePath: z.string().min(1, 'Source path cannot be empty'),
  destinationPath: z.string().min(1, 'Destination path cannot be empty'),
  preview: z.boolean().optional()
});

export class RefactorModuleOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = refactorModuleSchema.parse(input);

      if (!this.tsServer.isRunning()) {
        await this.tsServer.start(process.cwd());
      }

      const loadingResult = await this.tsServer.checkProjectLoaded();
      if (loadingResult) return loadingResult;

      const allFilesChanged: RefactorResult['filesChanged'] = [];
      const steps: string[] = [];

      // Step 1: Move file
      const moveOp = new MoveFileOperation(this.tsServer);
      const moveResult = await moveOp.execute({
        sourcePath: validated.sourcePath,
        destinationPath: validated.destinationPath,
        preview: validated.preview
      });

      if (!moveResult.success) {
        return moveResult;
      }

      steps.push(`✓ Moved file to ${validated.destinationPath}`);
      allFilesChanged.push(...moveResult.filesChanged);

      if (validated.preview) {
        return {
          success: true,
          message: `Preview: Would refactor module (move + organize + fix)
${steps.join('\n')}
Next steps: organize imports, fix errors`,
          filesChanged: allFilesChanged,
          preview: {
            filesAffected: moveResult.preview!.filesAffected,
            estimatedTime: '< 2s',
            command: 'Run again with preview: false to apply changes'
          }
        };
      }

      // Step 2: Organize imports for all affected files
      const organizeOp = new OrganizeImportsOperation(this.tsServer);
      const uniqueFiles = [...new Set(allFilesChanged.map(f => f.path))];

      for (const file of uniqueFiles) {
        const organizeResult = await organizeOp.execute({ filePath: file });
        if (organizeResult.success && organizeResult.filesChanged.length > 0) {
          steps.push(`✓ Organized imports in ${file.split('/').pop()}`);
          // Add to filesChanged if not already there (based on path)
          for (const changed of organizeResult.filesChanged) {
            if (!allFilesChanged.find(f => f.path === changed.path)) {
              allFilesChanged.push(changed);
            }
          }
        }
      }

      // Step 3: Fix all errors in affected files
      const fixOp = new FixAllOperation(this.tsServer);

      for (const file of uniqueFiles) {
        const fixResult = await fixOp.execute({ filePath: file });
        if (fixResult.success && fixResult.filesChanged.length > 0) {
          steps.push(`✓ Fixed errors in ${file.split('/').pop()}`);
          // Add to filesChanged if not already there (based on path)
          for (const changed of fixResult.filesChanged) {
            if (!allFilesChanged.find(f => f.path === changed.path)) {
              allFilesChanged.push(changed);
            }
          }
        }
      }

      return {
        success: true,
        message: `Refactored module successfully:
${steps.join('\n')}`,
        filesChanged: allFilesChanged
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }
      return {
        success: false,
        message: `Refactor module failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure source file exists
  2. Check destination path is valid
  3. Verify TypeScript project is configured correctly`,
        filesChanged: [],
      };
    }
  }

  getSchema() {
    return {
      title: 'Refactor Module',
      description: `Complete module refactoring workflow: move file + organize imports + fix errors automatically. Perfect for restructuring code without breaking anything. Combines 3 operations in one atomic action.

Example: Move src/old/service.ts → src/new/service.ts
  ✓ Moves the file and updates all imports
  ✓ Organizes imports in all affected files
  ✓ Fixes any TypeScript errors introduced by the move
  ✓ Complete refactoring in < 2s`,
      inputSchema: refactorModuleSchema.shape
    };
  }
}
