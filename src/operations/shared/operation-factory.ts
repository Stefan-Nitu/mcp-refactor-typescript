import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { BatchMoveFilesOperation } from '../batch-move-files.js';
import { CleanupCodebaseOperation } from '../cleanup-codebase.js';
import { ExtractConstantOperation } from '../extract-constant.js';
import { ExtractFunctionOperation } from '../extract-function.js';
import { ExtractVariableOperation } from '../extract-variable.js';
import { FindReferencesOperation } from '../find-references.js';
import { FixAllOperation } from '../fix-all.js';
import { InferReturnTypeOperation } from '../infer-return-type.js';
import { MoveFileOperation } from '../move-file.js';
import { OrganizeImportsOperation } from '../organize-imports.js';
import { RefactorModuleOperation } from '../refactor-module.js';
import { RefactoringProcessor } from '../refactoring-processor.js';
import { RemoveUnusedOperation } from '../remove-unused.js';
import { RenameOperation } from '../rename.js';
import { RenameFileOperation } from '../rename-file.js';
import { RestartTsServerOperation } from '../restart-tsserver.js';
import { EditApplicator } from './edit-applicator.js';
import { FileDiscovery } from './file-discovery.js';
import { FileMover } from './file-mover.js';
import { FileOperations } from './file-operations.js';
import { IndentationDetector } from './indentation-detector.js';
import { TextPositionConverter } from './text-position-converter.js';
import { TSServerGuard } from './tsserver-guard.js';

export function createRenameFileOperation(tsServer: TypeScriptServer) {
  return new RenameFileOperation(
    new TSServerGuard(tsServer),
    new FileDiscovery(tsServer),
    new FileMover(tsServer)
  );
}

export function createMoveFileOperation(tsServer: TypeScriptServer) {
  return new MoveFileOperation(
    new TSServerGuard(tsServer),
    new FileDiscovery(tsServer),
    new FileMover(tsServer)
  );
}

export function createBatchMoveFilesOperation(tsServer: TypeScriptServer) {
  return new BatchMoveFilesOperation(
    new TSServerGuard(tsServer),
    new FileDiscovery(tsServer),
    new FileMover(tsServer)
  );
}

export function createRenameOperation(tsServer: TypeScriptServer) {
  return new RenameOperation(
    tsServer,
    new FileOperations(),
    new TextPositionConverter(),
    new EditApplicator(),
    new TSServerGuard(tsServer),
    new FileDiscovery(tsServer)
  );
}

export function createOrganizeImportsOperation(tsServer: TypeScriptServer) {
  return new OrganizeImportsOperation(
    tsServer,
    new FileOperations(),
    new EditApplicator(),
    new TSServerGuard(tsServer)
  );
}

export function createFixAllOperation(tsServer: TypeScriptServer) {
  return new FixAllOperation(
    tsServer,
    new FileOperations(),
    new EditApplicator(),
    new TSServerGuard(tsServer)
  );
}

export function createRemoveUnusedOperation(tsServer: TypeScriptServer) {
  return new RemoveUnusedOperation(
    tsServer,
    new FileOperations(),
    new EditApplicator(),
    new TSServerGuard(tsServer)
  );
}

export function createFindReferencesOperation(tsServer: TypeScriptServer) {
  return new FindReferencesOperation(
    tsServer,
    new FileOperations(),
    new TextPositionConverter(),
    new TSServerGuard(tsServer),
    new FileDiscovery(tsServer)
  );
}

export function createExtractFunctionOperation(tsServer: TypeScriptServer) {
  return new ExtractFunctionOperation(
    tsServer,
    new RefactoringProcessor('function'),
    new FileOperations(),
    new TextPositionConverter(),
    new EditApplicator(),
    new IndentationDetector(),
    new TSServerGuard(tsServer)
  );
}

export function createExtractConstantOperation(tsServer: TypeScriptServer) {
  return new ExtractConstantOperation(
    tsServer,
    new RefactoringProcessor('const'),
    new FileOperations(),
    new TextPositionConverter(),
    new EditApplicator(),
    new IndentationDetector(),
    new TSServerGuard(tsServer)
  );
}

export function createExtractVariableOperation(tsServer: TypeScriptServer) {
  return new ExtractVariableOperation(
    tsServer,
    new RefactoringProcessor('const'),
    new FileOperations(),
    new TextPositionConverter(),
    new EditApplicator(),
    new IndentationDetector(),
    new TSServerGuard(tsServer)
  );
}

export function createInferReturnTypeOperation(tsServer: TypeScriptServer) {
  return new InferReturnTypeOperation(
    tsServer,
    new FileOperations(),
    new TextPositionConverter(),
    new EditApplicator(),
    new TSServerGuard(tsServer)
  );
}

export function createRefactorModuleOperation(tsServer: TypeScriptServer) {
  return new RefactorModuleOperation(
    new TSServerGuard(tsServer),
    createMoveFileOperation(tsServer),
    createOrganizeImportsOperation(tsServer),
    createFixAllOperation(tsServer)
  );
}

export function createCleanupCodebaseOperation(tsServer: TypeScriptServer) {
  return new CleanupCodebaseOperation(
    new TSServerGuard(tsServer),
    createOrganizeImportsOperation(tsServer)
  );
}

export function createRestartTsServerOperation(tsServer: TypeScriptServer) {
  return new RestartTsServerOperation(tsServer);
}
