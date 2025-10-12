import { readdir } from 'fs/promises';
import { dirname, join } from 'path';
import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { logger } from '../../utils/logger.js';

export interface ProjectStatus {
  isFullyLoaded: boolean;
  didScanTimeout: boolean;
}

export class FileDiscovery {
  private lastScanTimedOut = false;

  constructor(private tsServer: TypeScriptServer) {}

  async discoverRelatedFiles(filePath: string | string[]): Promise<ProjectStatus> {
    const files = Array.isArray(filePath) ? filePath : [filePath];

    for (const file of files) {
      await this.tsServer.openFile(file);
    }

    try {
      await this.discoverAndOpenImportingFiles(files);
    } catch {
      // Continue if file discovery fails - warnings will inform the user
    }

    return {
      isFullyLoaded: this.tsServer.isProjectLoaded(),
      didScanTimeout: this.lastScanTimedOut
    };
  }

  private async waitForFileIndexing(filePath: string, maxAttempts = 30): Promise<{ refs: Array<{ file: string }> } | null> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const refs = await this.tsServer.sendRequest<{
          refs: Array<{ file: string }>;
        }>('fileReferences', { file: filePath });

        if (refs !== null) {
          logger.debug({ attempt: i + 1, refsCount: refs.refs?.length || 0, file: filePath }, 'File indexed');
          return refs;
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return null;
  }

  private async scanTypeScriptFiles(dir: string, timeoutMs = 5000): Promise<string[]> {
    const files: string[] = [];
    const startTime = Date.now();
    let timedOut = false;

    const scan = async (currentDir: string): Promise<void> => {
      if (Date.now() - startTime > timeoutMs) {
        timedOut = true;
        logger.debug({ elapsed: Date.now() - startTime, filesFound: files.length }, 'Filesystem scan timeout');
        return;
      }

      try {
        const entries = await readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (Date.now() - startTime > timeoutMs) {
            timedOut = true;
            break;
          }

          const fullPath = join(currentDir, entry.name);

          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist') {
              continue;
            }
            await scan(fullPath);
          } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        logger.debug({ dir: currentDir, error }, 'Failed to scan directory');
      }
    };

    await scan(dir);
    this.lastScanTimedOut = timedOut;

    if (timedOut) {
      logger.debug({ filesFound: files.length, elapsed: Date.now() - startTime }, 'Filesystem scan incomplete (timeout)');
    } else {
      logger.debug({ filesFound: files.length, elapsed: Date.now() - startTime }, 'Filesystem scan complete');
    }

    return files;
  }

  private async discoverAndOpenImportingFiles(files: string[]): Promise<void> {
    const importingFiles = new Set<string>();

    for (const file of files) {
      const refs = await this.waitForFileIndexing(file);

      if (refs?.refs?.length) {
        logger.debug({ file, importersCount: refs.refs.length }, 'Found files that reference this file');
        refs.refs.forEach(ref => {
          if (ref.file !== file) {
            importingFiles.add(ref.file);
          }
        });
      } else if (!refs || refs.refs.length === 0) {
        logger.debug({ file }, 'File not indexed or has no refs, scanning for undiscovered files');

        const projectInfo = await this.tsServer.sendRequest<{
          configFileName: string;
          fileNames?: string[];
        }>('projectInfo', {
          file,
          needFileNameList: true
        });

        if (!projectInfo?.configFileName) continue;

        const projectRoot = dirname(projectInfo.configFileName);
        const knownFiles = new Set(projectInfo.fileNames || []);
        const allFiles = await this.scanTypeScriptFiles(projectRoot);

        allFiles
          .filter(f => !knownFiles.has(f) && !files.includes(f))
          .forEach(f => importingFiles.add(f));
      }
    }

    if (importingFiles.size > 0) {
      logger.debug({ count: importingFiles.size }, 'Opening importing files in parallel');

      await Promise.all(
        Array.from(importingFiles).map(file =>
          this.tsServer.openFile(file).catch(error => {
            logger.debug({ file, error }, 'Failed to open importing file');
          })
        )
      );
    }
  }

  buildWarningMessage(status: ProjectStatus, context: string): string {
    let warningMessage = '';

    if (!status.isFullyLoaded) {
      warningMessage += `\n\nWarning: TypeScript is still indexing the project. Some ${context} may have been missed.`;
    }

    if (status.didScanTimeout) {
      warningMessage += `\n\nWarning: File discovery timed out. Some files may not have been scanned. ${this.capitalize(context)} might be incomplete.`;
    }

    if (warningMessage) {
      warningMessage += ' If results seem incomplete, try running the operation again.';
    }

    return warningMessage;
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
