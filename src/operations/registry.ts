/**
 * Registry for all refactoring operations
 * Single place to manage and access all operations
 */

import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { RenameOperation } from './rename.js';
import { MoveFileOperation } from './move-file.js';
import { BatchMoveFilesOperation } from './batch-move-files.js';
import { OrganizeImportsOperation } from './organize-imports.js';
import { FixAllOperation } from './fix-all.js';
import { RemoveUnusedOperation } from './remove-unused.js';
import { FindReferencesOperation } from './find-references.js';
import { ExtractFunctionOperation } from './extract-function.js';
import { ExtractConstantOperation } from './extract-constant.js';
import { ExtractVariableOperation } from './extract-variable.js';
import { InlineVariableOperation } from './inline-variable.js';
import { InferReturnTypeOperation } from './infer-return-type.js';
import { RefactorModuleOperation } from './refactor-module.js';
import { CleanupCodebaseOperation } from './cleanup-codebase.js';
import { logger } from '../utils/logger.js';

import { z } from 'zod';

export interface Operation {
  execute(input: Record<string, unknown>): Promise<RefactorResult>;
  getSchema(): { title: string; description: string; inputSchema: z.ZodRawShape };
}

export class OperationRegistry {
  private operations = new Map<string, Operation>();
  private tsServer: TypeScriptServer;

  constructor() {
    this.tsServer = new TypeScriptServer();
    this.registerOperations();
  }

  registerOperations(): void {
    this.operations.set('rename', new RenameOperation(this.tsServer));
    this.operations.set('move_file', new MoveFileOperation(this.tsServer));
    this.operations.set('batch_move_files', new BatchMoveFilesOperation(this.tsServer));
    this.operations.set('organize_imports', new OrganizeImportsOperation(this.tsServer));
    this.operations.set('fix_all', new FixAllOperation(this.tsServer));
    this.operations.set('remove_unused', new RemoveUnusedOperation(this.tsServer));
    this.operations.set('find_references', new FindReferencesOperation(this.tsServer));
    this.operations.set('extract_function', new ExtractFunctionOperation(this.tsServer));
    this.operations.set('extract_constant', new ExtractConstantOperation(this.tsServer));
    this.operations.set('extract_variable', new ExtractVariableOperation(this.tsServer));
    this.operations.set('inline_variable', new InlineVariableOperation(this.tsServer));
    this.operations.set('infer_return_type', new InferReturnTypeOperation(this.tsServer));
    this.operations.set('refactor_module', new RefactorModuleOperation(this.tsServer));
    this.operations.set('cleanup_codebase', new CleanupCodebaseOperation(this.tsServer));
  }

  getOperation(name: string): Operation | undefined {
    return this.operations.get(name);
  }

  getAllOperations(): Map<string, Operation> {
    return this.operations;
  }

  getOperationNames(): string[] {
    return Array.from(this.operations.keys());
  }

  async initialize(): Promise<void> {
    // Check if we have any TS/JS files before starting tsserver
    const hasTypeScriptFiles = await this.hasTypeScriptFiles();

    if (hasTypeScriptFiles) {
      logger.info('TypeScript/JavaScript files detected, starting tsserver...');
      try {
        await this.tsServer.start(process.cwd());
      } catch (error) {
        logger.error({ err: error }, 'Failed to start tsserver');
      }
    } else {
      logger.info('No TypeScript/JavaScript files detected, tsserver will start on demand');
    }
  }

  async shutdown(): Promise<void> {
    // Stop all language servers
    if (this.tsServer.isRunning()) {
      await this.tsServer.stop();
    }
  }

  private async hasTypeScriptFiles(): Promise<boolean> {
    const { readdir } = await import('fs/promises');
    const { join } = await import('path');

    async function checkDir(dir: string, depth = 0): Promise<boolean> {
      if (depth > 2) return false; // Don't go too deep

      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
            return true;
          }

          if (entry.isDirectory() &&
              !entry.name.startsWith('.') &&
              entry.name !== 'node_modules' &&
              entry.name !== 'dist' &&
              entry.name !== 'build') {
            const hasFiles = await checkDir(join(dir, entry.name), depth + 1);
            if (hasFiles) return true;
          }
        }
      } catch {
        // Ignore permission errors etc
      }

      return false;
    }

    return checkDir(process.cwd());
  }
}