import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { BatchMoveFilesOperation } from '../batch-move-files.js';
import { MoveFileOperation } from '../move-file.js';
import { RenameFileOperation } from '../rename-file.js';
import { FileDiscovery } from './file-discovery.js';
import { FileMover } from './file-mover.js';
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
