import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { ModuleSpecifierPreference } from '../module-specifier-preference.js';

describe('ModuleSpecifierPreference', () => {
  let workspace: string;
  let mockTsServer: TypeScriptServer;
  let preference: ModuleSpecifierPreference;
  const sendRequestMock = mock();

  /** The class asks tsserver which config owns the file; that answer is the input */
  function projectUses(configFileName: string | undefined) {
    sendRequestMock.mockImplementation(async (command: string) =>
      command === 'projectInfo' && configFileName ? { configFileName } : {},
    );
  }

  function endingSentToServer(): unknown {
    const configure = sendRequestMock.mock.calls.find(
      ([command]) => command === 'configure',
    );
    return (
      configure?.[1] as
        | { preferences?: { importModuleSpecifierEnding?: unknown } }
        | undefined
    )?.preferences?.importModuleSpecifierEnding;
  }

  async function writeConfig(
    relativePath: string,
    contents: string,
  ): Promise<string> {
    const path = join(workspace, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, contents, 'utf-8');
    return path;
  }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'msp-'));
    sendRequestMock.mockReset();
    mockTsServer = {
      sendRequest: sendRequestMock,
    } as unknown as TypeScriptServer;
    preference = new ModuleSpecifierPreference(mockTsServer);
  });

  afterEach(() => rm(workspace, { recursive: true, force: true }));

  describe('resolving from the project tsconfig', () => {
    it('should ask for js when the config allows ts extensions', async () => {
      // Arrange
      projectUses(
        await writeConfig(
          'tsconfig.json',
          '{"compilerOptions":{"allowImportingTsExtensions":true,"noEmit":true}}',
        ),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('js');
    });

    it('should ask for the default when the config does not allow them', async () => {
      // Arrange
      projectUses(
        await writeConfig(
          'tsconfig.json',
          '{"compilerOptions":{"module":"NodeNext"}}',
        ),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('auto');
    });

    it('should ask for the default when the project has no config file', async () => {
      // Arrange - an inferred project reports no configFileName
      projectUses(undefined);

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('auto');
    });

    it('should ask for the default when the config file is missing', async () => {
      // Arrange
      projectUses(join(workspace, 'does-not-exist.json'));

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('auto');
    });

    it('should tolerate comments and trailing commas', async () => {
      // Arrange - tsconfig.json is JSONC, and editors write both
      projectUses(
        await writeConfig(
          'tsconfig.json',
          `{
  // the whole point of this fixture
  "compilerOptions": {
    /* block */
    "allowImportingTsExtensions": true,
  },
}`,
        ),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('js');
    });
  });

  describe('following extends', () => {
    it('should inherit the option from a relative parent', async () => {
      // Arrange
      await writeConfig(
        'base.json',
        '{"compilerOptions":{"allowImportingTsExtensions":true}}',
      );
      projectUses(
        await writeConfig('tsconfig.json', '{"extends":"./base.json"}'),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('js');
    });

    it('should not treat a relative parent as a directory', async () => {
      // Arrange - only bare specifiers get directory resolution; tsc rejects
      // this one outright with TS6053, so neither may the project inherit it
      await writeConfig(
        'configs/tsconfig.json',
        '{"compilerOptions":{"allowImportingTsExtensions":true}}',
      );
      projectUses(
        await writeConfig('tsconfig.json', '{"extends":"./configs"}'),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('auto');
    });

    it('should resolve a parent given as a bare package name', async () => {
      // Arrange - @tsconfig/* packages ship a tsconfig.json and no main/exports
      await writeConfig(
        'node_modules/fake-base/package.json',
        '{"name":"fake-base","version":"1.0.0"}',
      );
      await writeConfig(
        'node_modules/fake-base/tsconfig.json',
        '{"compilerOptions":{"allowImportingTsExtensions":true}}',
      );
      projectUses(
        await writeConfig('tsconfig.json', '{"extends":"fake-base"}'),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('js');
    });

    it('should let a child turn the inherited option back off', async () => {
      // Arrange
      await writeConfig(
        'base.json',
        '{"compilerOptions":{"allowImportingTsExtensions":true}}',
      );
      projectUses(
        await writeConfig(
          'tsconfig.json',
          '{"extends":"./base.json","compilerOptions":{"allowImportingTsExtensions":false}}',
        ),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('auto');
    });

    it('should let the last entry of an extends array win', async () => {
      // Arrange - TS 5 applies these in order, so the later one decides
      await writeConfig(
        'allows.json',
        '{"compilerOptions":{"allowImportingTsExtensions":true}}',
      );
      await writeConfig(
        'forbids.json',
        '{"compilerOptions":{"allowImportingTsExtensions":false}}',
      );
      projectUses(
        await writeConfig(
          'tsconfig.json',
          '{"extends":["./allows.json","./forbids.json"]}',
        ),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('auto');
    });

    it('should terminate on a config that extends itself', async () => {
      // Arrange
      projectUses(
        await writeConfig('tsconfig.json', '{"extends":"./tsconfig.json"}'),
      );

      // Act
      await preference.configureForFile(join(workspace, 'a.ts'));

      // Assert
      expect(endingSentToServer()).toBe('auto');
    });
  });
});
