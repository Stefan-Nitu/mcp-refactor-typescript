import { getLanguageServer } from './lsp-manager.js';

export async function extractVariable(
  filePath: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  variableName?: string
) {
  const server = await getLanguageServer();
  const range = {
    start: { line: startLine, column: startColumn },
    end: { line: endLine, column: endColumn }
  };
  
  const result = await server.extractVariable(filePath, range, variableName);
  
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        tool: 'typescript',
        action: 'extract_variable',
        status: result.success ? 'success' : 'error',
        message: result.message,
        filesChanged: result.filesChanged
      }, null, 2)
    }]
  };
}
