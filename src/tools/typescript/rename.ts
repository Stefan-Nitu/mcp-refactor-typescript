import { getLanguageServer } from './lsp-manager.js';

export async function rename(
  filePath: string,
  line: number,
  column: number,
  newName: string
) {
  try {
    const server = await getLanguageServer();
    const result = await server.rename(filePath, { line, column }, newName);

    if (result.success) {
      const response: any = {
        tool: 'typescript',
        action: 'rename',
        status: 'success',
        message: result.message,
        filesChanged: result.filesChanged
      };

      // Add detailed changes if available
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

        // Add summary
        const totalChanges = result.editDetails.reduce(
          (sum, detail) => sum + detail.edits.length, 0
        );
        response.summary = `Renamed ${totalChanges} occurrence(s) across ${result.editDetails.length} file(s)`;
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
            action: 'rename',
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
          action: 'rename',
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }, null, 2)
      }]
    };
  }
}