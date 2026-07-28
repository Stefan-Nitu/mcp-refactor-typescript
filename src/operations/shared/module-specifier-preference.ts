import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { logger } from '../../utils/logger.js';

type TypeScriptModule = typeof import('typescript');

let compiler: Promise<TypeScriptModule> | undefined;

/**
 * Megabytes of compiler for one boolean, so it is loaded only once a move needs
 * it. This is deliberately our own copy rather than the project's: it reads only
 * allowImportingTsExtensions, stable since 5.0. Anything version-sensitive would
 * have to resolve the project's TypeScript the way resolve-tsserver-path does.
 */
function loadCompiler(): Promise<TypeScriptModule> {
  compiler ??= import('typescript').then((module) => module.default ?? module);
  return compiler;
}

export class ModuleSpecifierPreference {
  constructor(private tsServer: TypeScriptServer) {}

  /**
   * TypeScript infers the extension to write from the imports already present
   * in the file it is editing, so a file it has just created gets nothing to
   * infer from and falls back to extensionless. Asking for "js" makes it emit
   * the project's real extension instead - which is ".ts" when the project sets
   * allowImportingTsExtensions.
   *
   * Sent unconditionally, and without a `file` scope. tsserver does support
   * per-file preferences, but scoping this one means resending formatOptions in
   * the same request - omitting them there crashes the handler. So it goes to
   * the shared host config, where leaving it unset would let one package's
   * answer stand for every later operation, including siblings that want no
   * extension at all. Overlapping moves across packages could still race.
   */
  async configureForFile(filePath: string): Promise<void> {
    await this.tsServer.sendRequest('configure', {
      preferences: {
        importModuleSpecifierEnding: await this.resolveEnding(filePath),
      },
    });
  }

  private async resolveEnding(filePath: string): Promise<'js' | 'auto'> {
    const configPath = await this.findConfigFile(filePath);
    if (!configPath) return 'auto';

    return (await this.allowsTsExtensions(configPath)) ? 'js' : 'auto';
  }

  private async findConfigFile(filePath: string): Promise<string | undefined> {
    const info = await this.tsServer
      .sendRequest<{ configFileName?: string }>('projectInfo', {
        file: filePath,
        needFileNameList: false,
      })
      .catch(() => null);

    // An inferred project reports no config file, and has no such option set
    return info?.configFileName?.endsWith('.json')
      ? info.configFileName
      : undefined;
  }

  /**
   * Left to the compiler rather than hand-parsed: tsconfig.json is JSONC, and
   * `extends` reaches through relative paths, directories, bare package names
   * and arrays where the last entry wins. `readDirectory` is stubbed out
   * because the `include` globs would walk the whole project to answer this.
   */
  private async allowsTsExtensions(configPath: string): Promise<boolean> {
    try {
      const ts = await loadCompiler();
      const parsed = ts.getParsedCommandLineOfConfigFile(
        configPath,
        undefined,
        {
          ...ts.sys,
          readDirectory: () => [],
          onUnRecoverableConfigFileDiagnostic: () => {},
        },
      );

      return parsed?.options.allowImportingTsExtensions === true;
    } catch (error) {
      logger.debug({ err: error, configPath }, 'Could not read tsconfig');
      return false;
    }
  }
}
