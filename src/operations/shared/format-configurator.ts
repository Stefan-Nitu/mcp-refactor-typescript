import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { IndentationDetector } from './indentation-detector.js';

export class FormatConfigurator {
  constructor(
    private tsServer: TypeScriptServer,
    private indentDetector: IndentationDetector
  ) {}

  async configureForFile(filePath: string, lines: string[]): Promise<void> {
    const indentUnit = this.indentDetector.detectIndentUnitOrDefault(lines);
    const indentSize = indentUnit === '\t' ? 4 : indentUnit.length;

    await this.tsServer.sendRequest('configure', {
      file: filePath,
      formatOptions: {
        indentSize,
        tabSize: indentSize,
        convertTabsToSpaces: indentUnit !== '\t'
      }
    });
  }
}
