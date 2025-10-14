import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { FormatConfigurator } from '../format-configurator.js';
import { IndentationDetector } from '../indentation-detector.js';

describe('FormatConfigurator', () => {
  let mockTsServer: TypeScriptServer;
  let indentDetector: IndentationDetector;
  let configurator: FormatConfigurator;

  beforeEach(() => {
    mockTsServer = {
      sendRequest: vi.fn()
    } as unknown as TypeScriptServer;

    indentDetector = new IndentationDetector();
    configurator = new FormatConfigurator(mockTsServer, indentDetector);
  });

  it('should configure TSServer with 2-space indentation', async () => {
    // Arrange
    const lines = [
      'function test() {',
      '  const x = 1;',
      '  return x;',
      '}'
    ];
    const filePath = '/test/file.ts';

    // Act
    await configurator.configureForFile(filePath, lines);

    // Assert
    expect(mockTsServer.sendRequest).toHaveBeenCalledWith('configure', {
      file: filePath,
      formatOptions: {
        indentSize: 2,
        tabSize: 2,
        convertTabsToSpaces: true
      }
    });
  });

  it('should configure TSServer with 4-space indentation', async () => {
    // Arrange
    const lines = [
      'function test() {',
      '    const x = 1;',
      '    return x;',
      '}'
    ];
    const filePath = '/test/file.ts';

    // Act
    await configurator.configureForFile(filePath, lines);

    // Assert
    expect(mockTsServer.sendRequest).toHaveBeenCalledWith('configure', {
      file: filePath,
      formatOptions: {
        indentSize: 4,
        tabSize: 4,
        convertTabsToSpaces: true
      }
    });
  });

  it('should configure TSServer with tab indentation', async () => {
    // Arrange
    const lines = [
      'function test() {',
      '\tconst x = 1;',
      '\treturn x;',
      '}'
    ];
    const filePath = '/test/file.ts';

    // Act
    await configurator.configureForFile(filePath, lines);

    // Assert
    expect(mockTsServer.sendRequest).toHaveBeenCalledWith('configure', {
      file: filePath,
      formatOptions: {
        indentSize: 4,
        tabSize: 4,
        convertTabsToSpaces: false
      }
    });
  });

  it('should use default 2-space indentation when no indentation detected', async () => {
    // Arrange
    const lines = ['const x = 1;'];
    const filePath = '/test/file.ts';

    // Act
    await configurator.configureForFile(filePath, lines);

    // Assert
    expect(mockTsServer.sendRequest).toHaveBeenCalledWith('configure', {
      file: filePath,
      formatOptions: {
        indentSize: 2,
        tabSize: 2,
        convertTabsToSpaces: true
      }
    });
  });
});
