/**
 * Registry for all refactoring operations
 * Single place to manage and access all operations
 */

import { RefactorResult, TypeScriptServer } from './language-servers/typescript/tsserver-client.js';
import { OperationName } from './operation-name.js';
import {
  createBatchMoveFilesOperation,
  createCleanupCodebaseOperation,
  createExtractConstantOperation,
  createExtractFunctionOperation,
  createExtractVariableOperation,
  createFindReferencesOperation,
  createFixAllOperation,
  createInferReturnTypeOperation,
  createMoveFileOperation,
  createOrganizeImportsOperation,
  createRefactorModuleOperation,
  createRemoveUnusedOperation,
  createRenameFileOperation,
  createRenameOperation,
  createRestartTsServerOperation
} from './operations/shared/operation-factory.js';
import { logger } from './utils/logger.js';

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
    this.operations.set(OperationName.RENAME, createRenameOperation(this.tsServer));
    this.operations.set(OperationName.RENAME_FILE, createRenameFileOperation(this.tsServer));
    this.operations.set(OperationName.MOVE_FILE, createMoveFileOperation(this.tsServer));
    this.operations.set(OperationName.BATCH_MOVE_FILES, createBatchMoveFilesOperation(this.tsServer));
    this.operations.set(OperationName.ORGANIZE_IMPORTS, createOrganizeImportsOperation(this.tsServer));
    this.operations.set(OperationName.FIX_ALL, createFixAllOperation(this.tsServer));
    this.operations.set(OperationName.REMOVE_UNUSED, createRemoveUnusedOperation(this.tsServer));
    this.operations.set(OperationName.FIND_REFERENCES, createFindReferencesOperation(this.tsServer));
    this.operations.set(OperationName.EXTRACT_FUNCTION, createExtractFunctionOperation(this.tsServer));
    this.operations.set(OperationName.EXTRACT_CONSTANT, createExtractConstantOperation(this.tsServer));
    this.operations.set(OperationName.EXTRACT_VARIABLE, createExtractVariableOperation(this.tsServer));
    this.operations.set(OperationName.INFER_RETURN_TYPE, createInferReturnTypeOperation(this.tsServer));
    this.operations.set(OperationName.REFACTOR_MODULE, createRefactorModuleOperation(this.tsServer));
    this.operations.set(OperationName.CLEANUP_CODEBASE, createCleanupCodebaseOperation(this.tsServer));
    this.operations.set(OperationName.RESTART_TSSERVER, createRestartTsServerOperation(this.tsServer));
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

  async close(): Promise<void> {
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