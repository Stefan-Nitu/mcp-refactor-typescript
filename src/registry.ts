/**
 * Registry for all refactoring operations
 * Single place to manage and access all operations
 */

import { RefactorResult, TypeScriptServer } from './language-servers/typescript/tsserver-client.js';
import { OperationName } from './operation-name.js';
import { logger } from './utils/logger.js';
import { CleanupCodebaseOperation } from './operations/cleanup-codebase.js';
import { ExtractConstantOperation } from './operations/extract-constant.js';
import { ExtractFunctionOperation } from './operations/extract-function.js';
import { ExtractVariableOperation } from './operations/extract-variable.js';
import { FindReferencesOperation } from './operations/find-references.js';
import { FixAllOperation } from './operations/fix-all.js';
import { InferReturnTypeOperation } from './operations/infer-return-type.js';
import { OrganizeImportsOperation } from './operations/organize-imports.js';
import { RefactorModuleOperation } from './operations/refactor-module.js';
import { RemoveUnusedOperation } from './operations/remove-unused.js';
import { RenameOperation } from './operations/rename.js';
import { RestartTsServerOperation } from './operations/restart-tsserver.js';
import { createBatchMoveFilesOperation, createMoveFileOperation, createRenameFileOperation } from './operations/shared/operation-factory.js';

export interface Operation {
  execute(input: Record<string, unknown>): Promise<RefactorResult>;
}

export class OperationRegistry {
  private operations = new Map<OperationName, Operation>();
  private tsServer: TypeScriptServer;

  constructor() {
    this.tsServer = new TypeScriptServer();
    this.registerOperations();
  }

  registerOperations(): void {
    this.operations.set(OperationName.RENAME, new RenameOperation(this.tsServer));
    this.operations.set(OperationName.RENAME_FILE, createRenameFileOperation(this.tsServer));
    this.operations.set(OperationName.MOVE_FILE, createMoveFileOperation(this.tsServer));
    this.operations.set(OperationName.BATCH_MOVE_FILES, createBatchMoveFilesOperation(this.tsServer));
    this.operations.set(OperationName.ORGANIZE_IMPORTS, new OrganizeImportsOperation(this.tsServer));
    this.operations.set(OperationName.FIX_ALL, new FixAllOperation(this.tsServer));
    this.operations.set(OperationName.REMOVE_UNUSED, new RemoveUnusedOperation(this.tsServer));
    this.operations.set(OperationName.FIND_REFERENCES, new FindReferencesOperation(this.tsServer));
    this.operations.set(OperationName.EXTRACT_FUNCTION, new ExtractFunctionOperation(this.tsServer));
    this.operations.set(OperationName.EXTRACT_CONSTANT, new ExtractConstantOperation(this.tsServer));
    this.operations.set(OperationName.EXTRACT_VARIABLE, new ExtractVariableOperation(this.tsServer));
    this.operations.set(OperationName.INFER_RETURN_TYPE, new InferReturnTypeOperation(this.tsServer));
    this.operations.set(OperationName.REFACTOR_MODULE, new RefactorModuleOperation(this.tsServer));
    this.operations.set(OperationName.CLEANUP_CODEBASE, new CleanupCodebaseOperation(this.tsServer));
    this.operations.set(OperationName.RESTART_TSSERVER, new RestartTsServerOperation(this.tsServer));
  }

  getOperation(name: OperationName): Operation | undefined {
    return this.operations.get(name);
  }

  getAllOperations(): Map<OperationName, Operation> {
    return this.operations;
  }

  getOperationNames(): OperationName[] {
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