/**
 * Cleanup codebase operation - uses tsr to remove unused exports + organize_imports
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type {
  RefactorResult,
  TypeScriptServer,
} from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { OrganizeImportsOperation } from './organize-imports.js';
import type { TSServerGuard } from './shared/tsserver-guard.js';
import { loadCompiler } from './shared/typescript-compiler.js';

const execFileAsync = promisify(execFile);

// Files that can start the reachability tsr traces - JavaScript too, under allowJs
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

/**
 * The CLI belonging to this package's own pinned `tsr`. Shelling out to the
 * `npx` of the project being cleaned reached neither this package's
 * node_modules nor its pinned version - it fetches a copy from the registry
 * at call time instead.
 */
function resolveTsrCli(): string {
  // tsr's exports map blocks a subpath, so anchor on its entry point and take
  // the sibling that its package.json declares as the bin
  return join(dirname(createRequire(import.meta.url).resolve('tsr')), 'cli.js');
}

function runTsr(flags: string[], entrypoints: string, cwd: string) {
  return execFileAsync(
    process.execPath,
    // Behind `--` the pattern is never read as an option, as `--write=…` was
    [resolveTsrCli(), ...flags, '--', entrypoints],
    {
      cwd,
      // tsr colours its output under CI or FORCE_COLOR, and the escape codes
      // would hide its summary line and end up in the messages quoting it
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    },
  );
}

function findNearestTsconfigDirectory(directory: string): string | null {
  let current = directory;
  while (!existsSync(join(current, 'tsconfig.json'))) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

/**
 * tsr counts every .d.ts file as an entrypoint besides those the patterns
 * match, so patterns that match none of its files raise no error in a project
 * that has one: tsr traces reachability from the declaration files alone, and
 * a real run deletes everything they do not import.
 */
async function checkEntrypoints(
  patterns: string[],
  joined: string,
  directory: string,
): Promise<RefactorResult | null> {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern);
    } catch (error) {
      return {
        success: false,
        message: `entrypoints are regular expressions, and ${JSON.stringify(pattern)} is not: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Write it as a regular expression matched against each file's absolute path, e.g. ["src/main\\\\.ts$"] - not a glob such as src/**/*.ts`,
        filesChanged: [],
      };
    }
  }

  // Listed as tsr lists them: the root files tsconfig.json defines, not the
  // files they import, read through ts.sys from the directory tsr runs in -
  // the real one, which spells every name the way tsr matches it. The
  // TypeScript tsr imports is this package's own, so the config is read by the
  // same parser, loaded only once a cleanup is set to delete files
  const ts = await loadCompiler();
  const projectRoot = await realpath(directory);
  const { config } = ts.readConfigFile(
    join(projectRoot, 'tsconfig.json'),
    ts.sys.readFile,
  );
  const { fileNames } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    projectRoot,
  );

  const entrypoint = new RegExp(joined);
  const matched = fileNames.some(
    (file) =>
      SOURCE_EXTENSIONS.has(extname(file)) &&
      !DECLARATION_FILE.test(file) &&
      entrypoint.test(file),
  );
  if (matched) return null;

  return {
    success: false,
    message: `entrypoints match no source file that ${join(directory, 'tsconfig.json')} includes

tsr also counts every .d.ts file as an entrypoint, so with no other it would keep only what those import and delete everything else.

Try:
  1. Write entrypoints as regular expressions matched against each file's absolute path, e.g. ["src/main\\\\.ts$"] - the real path, where the project is reached through a symlink
  2. Check tsconfig.json includes the files they should match`,
    filesChanged: [],
  };
}

/** What execFile rejects with when tsr exits non-zero or cannot start */
interface TsrError {
  code?: number;
  killed?: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
}

/** tsr prints its own errors to stdout, and a crash's trace goes to stderr */
function tsrFailure(heading: string, error: TsrError): RefactorResult {
  const output =
    [error.stdout, error.stderr].filter(Boolean).join('\n').trim() ||
    error.message;

  return {
    success: false,
    message: `${heading}:
${output}

Try:
  1. Write entrypoints as regular expressions matched against each file's absolute path, e.g. ["src/main\\\\.ts$"]
  2. Check tsconfig.json includes the files they should match`,
    filesChanged: [],
  };
}

const cleanupCodebaseSchema = z.object({
  directory: z.string().min(1, 'Directory cannot be empty'),
  entrypoints: z
    .array(z.string())
    .optional()
    .describe(
      'Starting files your app runs from (regex patterns). Examples: ["src/main\\\\.ts$"]. Defaults to main/index/app/server files',
    ),
  deleteUnusedFiles: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Delete files with no used exports (default: false). When false, only removes unused exports within files.',
    ),
  preview: z.boolean().optional(),
});

export class CleanupCodebaseOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private tsServerGuard: TSServerGuard,
    private organizeImportsOp: OrganizeImportsOperation,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = cleanupCodebaseSchema.parse(input);
      const directory = resolve(validated.directory);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      const tsFiles = await this.findTypeScriptFiles(directory);

      if (tsFiles.length === 0) {
        return {
          success: false,
          message: `No TypeScript files found in ${directory}

Try:
  1. Check the directory path is correct
  2. Ensure directory contains .ts or .tsx files
  3. Verify you have read permissions`,
          filesChanged: [],
        };
      }

      // Passing the nearest tsconfig.json as --project would not rescue a
      // subfolder: tsr resolves the paths inside it against the directory it
      // runs in, so its include globs match nothing
      if (validated.deleteUnusedFiles) {
        const projectRoot = findNearestTsconfigDirectory(directory);
        if (projectRoot !== directory) {
          const nearest = projectRoot
            ? `Nearest: ${projectRoot}`
            : 'No tsconfig.json found above it either.';
          return {
            success: false,
            message: `deleteUnusedFiles needs the project root (the directory containing tsconfig.json), but ${directory} has none. ${nearest}

tsr takes compiler options only from a tsconfig.json in the directory it runs in. Without one it uses the defaults, ignoring paths, moduleResolution and the rest, so files that are still imported can look unused and be deleted.

Try:
  1. Set directory to the project root
  2. Omit deleteUnusedFiles to only organize imports in ${directory}`,
            filesChanged: [],
          };
        }
      }

      const defaultEntrypoints =
        'main\\.tsx?$|index\\.tsx?$|app\\.tsx?$|server\\.tsx?$';
      const testFilePatterns =
        '.*\\.test\\.tsx?$|.*\\.spec\\.tsx?$|.*/__tests__/.*\\.tsx?$';
      const entrypoints =
        validated.entrypoints?.join('|') ||
        `${defaultEntrypoints}|${testFilePatterns}`;

      if (validated.deleteUnusedFiles) {
        const entrypointFailure = await checkEntrypoints(
          validated.entrypoints ?? [],
          entrypoints,
          directory,
        );
        if (entrypointFailure) return entrypointFailure;
      }

      if (validated.preview) {
        if (validated.deleteUnusedFiles) {
          try {
            // A check exits 0 only when it finds nothing to remove
            await runTsr(['--recursive'], entrypoints, directory);

            return {
              success: true,
              message: `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)\n\nNo unused exports or files found!\n- All exports are used\n- No files would be deleted`,
              filesChanged: [],
              preview: {
                filesAffected: 0,
                estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
                command: 'Run again with preview: false to apply changes',
              },
            };
          } catch (error: unknown) {
            const execError = error as TsrError;

            // A check that finds code to remove exits 1 as well, but only it
            // ends by printing a ✖ summary of what it found
            if (execError.code === 1 && /^✖ /m.test(execError.stdout ?? '')) {
              const lines = (execError.stdout ?? '')
                .trim()
                .split('\n')
                .filter((l) => l.trim().length > 0);

              let previewMessage = `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)\n\n`;

              previewMessage += `TSR would make changes:\n${lines.slice(0, 20).join('\n')}`;
              if (lines.length > 20) {
                previewMessage += `\n... and ${lines.length - 20} more changes`;
              }
              previewMessage +=
                '\n\nWill also organize imports in affected files';

              return {
                success: true,
                message: previewMessage,
                filesChanged: [],
                preview: {
                  filesAffected: lines.length,
                  estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
                  command: 'Run again with preview: false to apply changes',
                },
              };
            }

            return tsrFailure('Preview failed', execError);
          }
        } else {
          return {
            success: true,
            message: `Preview: Would cleanup ${tsFiles.length} TypeScript file(s)\n\nOrganize imports only\nTo remove unused exports/files, set deleteUnusedFiles: true`,
            filesChanged: [],
            preview: {
              filesAffected: tsFiles.length,
              estimatedTime: `< ${Math.max(2, Math.ceil(tsFiles.length / 10))}s`,
              command: 'Run again with preview: false to apply changes',
            },
          };
        }
      }

      const steps: string[] = [];
      const filesChanged: RefactorResult['filesChanged'] = [];

      // Only run tsr if deleteUnusedFiles is true
      if (validated.deleteUnusedFiles) {
        try {
          await runTsr(['--write', '--recursive'], entrypoints, directory);
          steps.push('Removed unused exports and files (tsr)');
        } catch (error: unknown) {
          const execError = error as TsrError;

          if (execError.killed) {
            return {
              success: false,
              message:
                'tsr timed out after 60 seconds - project may be too large',
              filesChanged: [],
            };
          }

          // tsr --write exits 0 whenever it succeeds, whatever it removed
          return tsrFailure(
            'tsr failed, and may have changed files before it stopped',
            execError,
          );
        }
      } else {
        steps.push('Skipped unused export removal (deleteUnusedFiles: false)');
      }

      const affectedFiles: string[] = [];

      for (const file of tsFiles) {
        const organizeResult = await this.organizeImportsOp.execute({
          filePath: file,
        });
        // Every operation re-syncs the files left open, a stat apiece, so a
        // sweep that kept them all open grew with the square of its size
        await this.tsServer.closeFile(file);
        if (organizeResult.success && organizeResult.filesChanged.length > 0) {
          affectedFiles.push(file);
          filesChanged.push(...organizeResult.filesChanged);
        }
      }

      if (affectedFiles.length > 0) {
        steps.push(`✓ Organized imports in ${affectedFiles.length} file(s)`);
      }

      // For large operations (>20 files), return summary to avoid token limits
      const shouldSummarize = affectedFiles.length > 20;
      const responseFilesChanged = shouldSummarize
        ? affectedFiles.slice(0, 20).map((path) => ({
            file: path.split('/').pop() || path,
            path,
            edits: [
              { line: 1, old: '', new: '(imports organized, details omitted)' },
            ],
          }))
        : filesChanged;

      return {
        success: true,
        message: `Cleanup completed successfully:
${steps.join('\n')}

Processed ${tsFiles.length} TypeScript file(s)${shouldSummarize ? `\n\n⚠️  Showing summary for first 20 of ${affectedFiles.length} affected files to avoid response size limits` : ''}`,
        filesChanged: responseFilesChanged,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }
      return {
        success: false,
        message: `Cleanup codebase failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure directory exists and is readable
  2. Check TypeScript project is configured
  3. Verify files can be analyzed by TypeScript
  4. Install tsr: npm install tsr`,
        filesChanged: [],
      };
    }
  }

  private async findTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function scan(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(directory, entry.name);

        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name.startsWith('.') ||
            entry.name === 'dist'
          ) {
            continue;
          }
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (ext === '.ts' || ext === '.tsx') {
            files.push(fullPath);
          }
        }
      }
    }

    await scan(dir);
    return files;
  }
}
