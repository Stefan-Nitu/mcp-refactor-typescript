import { getLanguageServer } from './lsp-manager.js';
import { rename as renameFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export async function moveFile(sourcePath: string, destinationPath: string) {
  try {
    const server = await getLanguageServer();

    if (!server.isProjectLoaded()) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            tool: 'typescript',
            action: 'move_file',
            status: 'error',
            error: 'TypeScript is still indexing the project. Please wait a moment and try again.'
          }, null, 2)
        }]
      };
    }

    // Get import updates BEFORE moving the file
    const result = await server.moveFile(sourcePath, destinationPath);

    // Now actually move the file on disk
    await mkdir(dirname(destinationPath), { recursive: true });
    await renameFile(sourcePath, destinationPath);

    if (result.success) {
      const response: any = {
        tool: 'typescript',
        action: 'move_file',
        status: 'success',
        message: result.message,
        movedFrom: sourcePath,
        movedTo: destinationPath
      };

      if (result.filesChanged && result.filesChanged.length > 0) {
        response.importsUpdated = result.filesChanged;
        response.summary = `Moved file and updated imports in ${result.filesChanged.length} file(s)`;
      }

      if (result.editDetails && result.editDetails.length > 0) {
        response.changes = result.editDetails.map(detail => ({
          file: detail.filePath.split('/').pop(),
          path: detail.filePath,
          edits: detail.edits.map(edit => ({
            line: edit.line,
            old: edit.oldText,
            new: edit.newText
          }))
        }));
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } else {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            tool: 'typescript',
            action: 'move_file',
            status: 'error',
            error: result.message
          }, null, 2)
        }]
      };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          tool: 'typescript',
          action: 'move_file',
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }, null, 2)
      }]
    };
  }
}
