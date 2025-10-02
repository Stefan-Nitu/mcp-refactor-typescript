import { getLanguageServer } from './lsp-manager.js';

export async function fixAll(filePath: string) {
  try {
    const server = await getLanguageServer();
    const result = await server.fixAll(filePath);

    if (result.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            tool: 'typescript',
            action: 'fix_all',
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
            action: 'fix_all',
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
          action: 'fix_all',
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }, null, 2)
      }]
    };
  }
}
