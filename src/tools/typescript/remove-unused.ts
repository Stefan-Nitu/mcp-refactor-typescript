import { getLanguageServer } from './lsp-manager.js';

export async function removeUnused(filePath: string) {
  const server = await getLanguageServer();
  
  // TypeScript language server doesn't have a specific removeUnused method
  // We'll use fix all with specific code action
  const result = await server.fixAll(filePath);
  
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        tool: 'typescript',
        action: 'remove_unused',
        status: result.success ? 'success' : 'error',
        message: result.success ? 'Removed unused code' : result.message,
        filesChanged: result.filesChanged
      }, null, 2)
    }]
  };
}
