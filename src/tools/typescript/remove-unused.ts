import { getLanguageServer } from './lsp-manager.js';

export async function removeUnused(filePath: string) {
  try {
    const server = await getLanguageServer();
    const result = await server.removeUnused(filePath);

    if (result.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            tool: 'typescript',
            action: 'remove_unused',
            status: 'success',
            message: result.message,
            filesChanged: result.filesChanged
          }, null, 2)
        }]
      };
    } else {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            tool: 'typescript',
            action: 'remove_unused',
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
          action: 'remove_unused',
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }, null, 2)
      }]
    };
  }
}
