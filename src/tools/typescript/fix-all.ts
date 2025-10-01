import { getLanguageServer } from './lsp-manager.js';

export async function fixAll(filePath: string) {
  const server = await getLanguageServer();
  const result = await server.fixAll(filePath);
  
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        tool: 'typescript',
        action: 'fix_all',
        status: result.success ? 'success' : 'error',
        message: result.message,
        filesChanged: result.filesChanged
      }, null, 2)
    }]
  };
}
