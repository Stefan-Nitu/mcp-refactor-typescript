import { getLanguageServer } from './lsp-manager.js';

export async function extractFunction(
  filePath: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  functionName?: string
) {
  const server = await getLanguageServer();
  const range = {
    start: { line: startLine, column: startColumn },
    end: { line: endLine, column: endColumn }
  };
  
  const result = await server.extractFunction(filePath, range, functionName);
  
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        tool: 'typescript',
        action: 'extract_function',
        status: result.success ? 'success' : 'error',
        message: result.message,
        filesChanged: result.filesChanged
      }, null, 2)
    }]
  };
}
