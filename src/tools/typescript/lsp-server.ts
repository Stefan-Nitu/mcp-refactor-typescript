import { spawn, ChildProcess } from 'child_process';
import {
  createMessageConnection,
  MessageConnection,
  InitializeParams,
  InitializeResult,
  DidOpenTextDocumentParams,
  DidOpenTextDocumentNotification,
  WorkspaceEdit,
  Position as LSPPosition,
  Range as LSPRange,
  RequestType,
  NotificationType,
  CodeActionKind,
  CodeActionParams,
  CodeAction,
  ExecuteCommandParams
} from 'vscode-languageserver-protocol';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { readFile, writeFile } from 'fs/promises';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, join, relative, basename } from 'path';
import { Position, Range, RefactorResult } from '../../types/refactoring.js';
import { WorkspaceEditHandler } from '../../utils/workspace-edit.js';

export class TypeScriptLanguageServer {
  private serverProcess: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private initialized = false;
  private rootUri: string;
  private openDocuments = new Set<string>();
  private editHandler = new WorkspaceEditHandler();
  private projectLoaded = false;

  constructor(rootPath?: string) {
    this.rootUri = pathToFileURL(rootPath || process.cwd()).toString();
  }

  async isConnected(): Promise<boolean> {
    if (!this.initialized || !this.connection) return false;
    try {
      // Try a simple request to test the connection
      await this.connection.sendRequest('workspace/symbol', { query: '' });
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.serverProcess = spawn('npx', ['typescript-language-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    if (!this.serverProcess.stdin || !this.serverProcess.stdout) {
      throw new Error('Failed to create TypeScript language server process');
    }

    this.serverProcess.stderr?.on('data', (data) => {
      console.error('[TypeScript LSP]', data.toString());
    });

    this.connection = createMessageConnection(
      new StreamMessageReader(this.serverProcess.stdout),
      new StreamMessageWriter(this.serverProcess.stdin)
    );

    // Listen for notifications from the language server
    this.connection.onNotification((method: string, params: any) => {
      console.error(`[LSP Notification] ${method}:`, JSON.stringify(params, null, 2));
    });

    // Handle workspace/applyEdit requests from the server
    this.connection.onRequest('workspace/applyEdit', async (params: any) => {
      const applied = await this.editHandler.applyWorkspaceEdit(params.edit);
      return { applied: applied.length > 0 };
    });

    // Handle TypeScript-specific requests
    this.connection.onRequest('_typescript.rename', async () => {
      return {};
    });

    this.connection.listen();

    const initParams: InitializeParams = {
      processId: process.pid,
      rootUri: this.rootUri,
      initializationOptions: {
        preferences: {
          includeCompletionsForModuleExports: false,
          includeCompletionsWithInsertText: false
        },
        tsserver: {
          logVerbosity: 'off'
        }
      },
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: false
          },
          rename: { prepareSupport: true },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  CodeActionKind.RefactorExtract,
                  CodeActionKind.RefactorInline,
                  CodeActionKind.Source,
                  CodeActionKind.SourceOrganizeImports
                ]
              }
            }
          }
        },
        workspace: {
          workspaceEdit: {
            resourceOperations: ['create', 'rename', 'delete']
          }
        }
      }
    };

    await this.connection.sendRequest('initialize', initParams);
    await this.connection.sendNotification('initialized');

    this.initialized = true;

    // Start monitoring tsserver for project loading
    this.monitorProjectLoading();
  }

  private monitorProjectLoading(): void {
    const rootPath = fileURLToPath(this.rootUri);
    console.error('[LSP] Starting tsserver monitor in:', rootPath);
    const tsserver = spawn('npx', ['tsserver'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      cwd: rootPath
    });

    tsserver.stderr?.on('data', (data) => {
      console.error('[LSP tsserver stderr]', data.toString());
    });

    let seq = 0;
    const send = (command: string, args: any = {}) => {
      const msg = JSON.stringify({ seq: seq++, type: 'request', command, arguments: args }) + '\n';
      tsserver.stdin?.write(msg);
    };

    let output = '';
    tsserver.stdout?.on('data', (data) => {
      output += data.toString();
      const lines = output.split('\n');
      output = lines.pop() || '';

      lines.forEach(line => {
        if (!line.trim() || line.startsWith('Content-Length:')) return;

        try {
          const msg = JSON.parse(line);
          console.error('[LSP Monitor] Received:', msg.type, msg.event || msg.command);
          if (msg.type === 'event' && msg.event === 'projectLoadingFinish') {
            console.error('[LSP] TypeScript project loaded:', msg.body?.projectName);
            this.projectLoaded = true;
            tsserver.kill();
          }
        } catch {}
      });
    });

    send('configure', { preferences: {} });
    send('open', {
      file: rootPath + '/tsconfig.json',
      fileContent: '{}',
      scriptKindName: 'TS'
    });
  }

  isProjectLoaded(): boolean {
    return this.projectLoaded;
  }

  private async checkProjectLoaded(waitTime = 30000): Promise<RefactorResult | null> {
    if (this.projectLoaded) return null;

    // Wait up to waitTime for project to load
    const startTime = Date.now();
    while (Date.now() - startTime < waitTime) {
      if (this.projectLoaded) {
        console.error(`[LSP] Project loaded after ${Date.now() - startTime}ms wait`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      success: false,
      message: `TypeScript is still indexing the project after waiting ${waitTime / 1000}s. For large projects, this can take longer. Please try again in a moment.`
    };
  }

  async shutdown(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.sendRequest('shutdown');
        await this.connection.sendNotification('exit');
      } catch (error) {
        console.error('[TypeScript LSP] Shutdown error:', error);
      }
      this.connection.dispose();
    }

    if (this.serverProcess) {
      this.serverProcess.kill();
    }

    this.initialized = false;
    this.openDocuments.clear();
  }

  async openDocument(filePath: string): Promise<string> {
    const uri = pathToFileURL(filePath).toString();

    if (this.openDocuments.has(uri)) {
      return uri;
    }

    const content = await readFile(filePath, 'utf-8');
    const languageId = filePath.endsWith('.ts') ? 'typescript' :
                       filePath.endsWith('.tsx') ? 'typescriptreact' :
                       filePath.endsWith('.jsx') ? 'javascriptreact' : 'javascript';

    const params: DidOpenTextDocumentParams = {
      textDocument: { uri, languageId, version: 1, text: content }
    };

    await this.connection!.sendNotification(DidOpenTextDocumentNotification.type, params);
    this.openDocuments.add(uri);
    return uri;
  }

  private async ensureDocumentOpen(filePath: string): Promise<string> {
    return this.openDocument(filePath);
  }

  private toLSPPosition(pos: Position): LSPPosition {
    return { line: pos.line - 1, character: pos.column - 1 };
  }

  private toLSPRange(range: Range): LSPRange {
    return { start: this.toLSPPosition(range.start), end: this.toLSPPosition(range.end) };
  }

  async rename(filePath: string, position: Position, newName: string): Promise<RefactorResult> {
    if (!this.initialized) await this.initialize();

    const loadingCheck = await this.checkProjectLoaded();
    if (loadingCheck) return loadingCheck;

    const uri = await this.ensureDocumentOpen(filePath);
    const lspPosition = this.toLSPPosition(position);

    try {
      const prepareResult = await this.connection!.sendRequest('textDocument/prepareRename', {
        textDocument: { uri },
        position: lspPosition
      });

      if (!prepareResult) {
        return { success: false, message: 'Cannot rename at this location' };
      }
    } catch (error) {
      return { success: false, message: `Cannot rename: ${error}` };
    }

    // Open related files to ensure cross-file rename works
    // TypeScript LSP only finds references in already-opened files
    try {
      const { readdir } = await import('fs/promises');
      const { readFile } = await import('fs/promises');
      const fileDir = dirname(filePath);
      const parentDir = dirname(fileDir);

      // Strategy: Open files that import the current file or are imported by it
      const openedFiles = new Set<string>();
      openedFiles.add(filePath);

      // Helper to find TypeScript files in a directory
      const findTsFiles = async (dir: string, depth: number = 0): Promise<string[]> => {
        if (depth > 2) return []; // Limit depth to avoid scanning entire project

        const files: string[] = [];
        try {
          const entries = await readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = join(dir, entry.name);

            if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
              files.push(fullPath);
            } else if (entry.isDirectory() &&
                      !entry.name.startsWith('.') &&
                      entry.name !== 'node_modules' &&
                      entry.name !== 'dist') {
              const subFiles = await findTsFiles(fullPath, depth + 1);
              files.push(...subFiles);
            }
          }
        } catch (error) {
          console.error(`[LSP] Error scanning directory ${dir}:`, error);
        }

        return files;
      };

      // Find TypeScript files in the current directory and parent directory
      const nearbyFiles = [
        ...await findTsFiles(fileDir),
        ...await findTsFiles(parentDir, 1)
      ];

      // Open files that might contain references
      const currentFileName = basename(filePath, '.ts').replace('.tsx', '');

      for (const file of nearbyFiles) {
        if (!openedFiles.has(file)) {
          try {
            // Quick check if file might reference our symbol
            const content = await readFile(file, 'utf-8');

            // Look for imports of the current file or usage of the class/interface name
            if (content.includes(currentFileName) ||
                content.includes(`from '`) ||
                content.includes(`from "`)) {
              await this.ensureDocumentOpen(file);
              openedFiles.add(file);
            }
          } catch (error) {
            console.error(`[LSP] Could not check file ${file}:`, error);
          }
        }
      }

      // Give LSP time to index the newly opened files
      if (openedFiles.size > 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error('[LSP] Could not open related files:', error);
    }

    const workspaceEdit: WorkspaceEdit | null = await this.connection!.sendRequest('textDocument/rename', {
      textDocument: { uri },
      position: lspPosition,
      newName
    });

    console.error('[LSP] Rename workspace edit:', JSON.stringify(workspaceEdit, null, 2));

    if (!workspaceEdit) {
      return { success: false, message: 'No rename edits returned' };
    }

    const filesChanged = await this.editHandler.applyWorkspaceEdit(workspaceEdit);
    const editDetails = this.editHandler.getEditDetails();

    return {
      success: true,
      message: `Renamed to "${newName}"`,
      filesChanged,
      editDetails
    };
  }

  async extractFunction(filePath: string, range: Range, _functionName?: string): Promise<RefactorResult> {
    if (!this.initialized) await this.initialize();

    const loadingCheck = await this.checkProjectLoaded();
    if (loadingCheck) return loadingCheck;

    const uri = await this.ensureDocumentOpen(filePath);
    const lspRange = this.toLSPRange(range);

    const params: CodeActionParams = {
      textDocument: { uri },
      range: lspRange,
      context: {
        diagnostics: [],
        only: [CodeActionKind.RefactorExtract]
      }
    };

    const actions = await this.connection!.sendRequest('textDocument/codeAction', params) as CodeAction[];

    console.error('[LSP] Available extract actions:', actions?.map(a => a.title));

    const extractAction = actions?.find(a =>
      a.title.toLowerCase().includes('function') ||
      a.title.toLowerCase().includes('method')
    );

    if (!extractAction) {
      return { success: false, message: `No extract function action available. Available actions: ${actions?.map(a => a.title).join(', ') || 'none'}` };
    }

    if (extractAction.edit) {
      const filesChanged = await this.editHandler.applyWorkspaceEdit(extractAction.edit);
      return {
        success: true,
        message: 'Extracted function',
        filesChanged
      };
    } else if (extractAction.command) {
      await this.connection!.sendRequest('workspace/executeCommand', {
        command: extractAction.command.command,
        arguments: extractAction.command.arguments
      });
      return {
        success: true,
        message: 'Extracted function'
      };
    }

    return { success: false, message: 'Could not extract function' };
  }

  async organizeImports(filePath: string): Promise<RefactorResult> {
    if (!this.initialized) await this.initialize();

    const loadingCheck = await this.checkProjectLoaded();
    if (loadingCheck) return loadingCheck;

    const uri = await this.ensureDocumentOpen(filePath);

    const params: ExecuteCommandParams = {
      command: '_typescript.organizeImports',
      arguments: [uri]
    };

    await this.connection!.sendRequest('workspace/executeCommand', params);

    return {
      success: true,
      message: 'Organized imports',
      filesChanged: [filePath]
    };
  }

  async extractVariable(filePath: string, range: Range, _variableName?: string): Promise<RefactorResult> {
    if (!this.initialized) await this.initialize();

    const loadingCheck = await this.checkProjectLoaded();
    if (loadingCheck) return loadingCheck;

    const uri = await this.ensureDocumentOpen(filePath);
    const lspRange = this.toLSPRange(range);

    const params: CodeActionParams = {
      textDocument: { uri },
      range: lspRange,
      context: {
        diagnostics: [],
        only: [CodeActionKind.RefactorExtract]
      }
    };

    const actions = await this.connection!.sendRequest('textDocument/codeAction', params) as CodeAction[];

    const extractAction = actions?.find(a =>
      a.title.toLowerCase().includes('constant') ||
      a.title.toLowerCase().includes('variable')
    );

    if (!extractAction) {
      return { success: false, message: 'No extract variable action available' };
    }

    if (extractAction.edit) {
      const filesChanged = await this.editHandler.applyWorkspaceEdit(extractAction.edit);
      return {
        success: true,
        message: 'Extracted variable',
        filesChanged
      };
    } else if (extractAction.command) {
      await this.connection!.sendRequest('workspace/executeCommand', {
        command: extractAction.command.command,
        arguments: extractAction.command.arguments
      });
      return {
        success: true,
        message: 'Extracted variable'
      };
    }

    return { success: false, message: 'Could not extract variable' };
  }

  async fixAll(filePath: string): Promise<RefactorResult> {
    if (!this.initialized) await this.initialize();

    const loadingCheck = await this.checkProjectLoaded();
    if (loadingCheck) return loadingCheck;

    const uri = await this.ensureDocumentOpen(filePath);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const params: CodeActionParams = {
      textDocument: { uri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: lines.length - 1, character: lines[lines.length - 1].length }
      },
      context: {
        diagnostics: [],
        only: ['source.fixAll.ts']
      }
    };

    const actions = await this.connection!.sendRequest('textDocument/codeAction', params) as CodeAction[];

    if (!actions || actions.length === 0) {
      return { success: true, message: 'No fixes needed' };
    }

    for (const action of actions) {
      if (action.edit) {
        await this.editHandler.applyWorkspaceEdit(action.edit);
      } else if (action.command) {
        await this.connection!.sendRequest('workspace/executeCommand', {
          command: action.command.command,
          arguments: action.command.arguments
        });
      }
    }

    return {
      success: true,
      message: 'Applied all fixes',
      filesChanged: [filePath]
    };
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<RefactorResult> {
    if (!this.initialized) await this.initialize();

    const loadingCheck = await this.checkProjectLoaded();
    if (loadingCheck) return loadingCheck;

    // Open the file first so LSP knows about its imports
    await this.ensureDocumentOpen(sourcePath);

    const sourceUri = pathToFileURL(sourcePath).toString();
    const destUri = pathToFileURL(destinationPath).toString();

    const workspaceEdit: WorkspaceEdit | null = await this.connection!.sendRequest('workspace/willRenameFiles', {
      files: [{
        oldUri: sourceUri,
        newUri: destUri
      }]
    });

    console.error('[LSP] willRenameFiles workspace edit:', JSON.stringify(workspaceEdit, null, 2));

    if (workspaceEdit) {
      const filesChanged = await this.editHandler.applyWorkspaceEdit(workspaceEdit);
      const editDetails = this.editHandler.getEditDetails();

      // Additionally update mock() and require() paths that LSP doesn't handle
      await this.updateMockAndRequirePaths(sourcePath, destinationPath);

      return {
        success: true,
        message: `Moved file to ${destinationPath}`,
        filesChanged,
        editDetails
      };
    }

    return {
      success: true,
      message: `Moved file to ${destinationPath} (no import updates needed)`
    };
  }

  private async updateMockAndRequirePaths(sourcePath: string, destinationPath: string): Promise<void> {
    const sourceDir = dirname(sourcePath);
    const destDir = dirname(destinationPath);

    // Read the file content at the source location (before it's moved on disk)
    let content = await readFile(sourcePath, 'utf-8');

    // Update mock paths
    content = this.updateMockPaths(content, sourceDir, destDir);

    // Update require paths
    content = this.updateRequirePaths(content, sourceDir, destDir);

    // Write back
    await writeFile(sourcePath, content, 'utf-8');
  }

  private updateMockPaths(content: string, sourceDir: string, destDir: string): string {
    return content.replace(
      /\.mock\s*\(\s*['"](\.\.[/\\].*?|\.\/.*?)['"]/g,
      (_match, oldPath) => {
        const absolutePath = join(sourceDir, oldPath);
        const newRelativePath = relative(destDir, absolutePath).replace(/\\/g, '/');
        const fixedPath = newRelativePath.startsWith('.') ? newRelativePath : `./${newRelativePath}`;
        return `.mock('${fixedPath}'`;
      }
    );
  }

  private updateRequirePaths(content: string, sourceDir: string, destDir: string): string {
    return content.replace(
      /require\s*\(\s*['"](\.\.[/\\].*?|\.\/.*?)['"]/g,
      (_match, oldPath) => {
        const absolutePath = join(sourceDir, oldPath);
        const newRelativePath = relative(destDir, absolutePath).replace(/\\/g, '/');
        const fixedPath = newRelativePath.startsWith('.') ? newRelativePath : `./${newRelativePath}`;
        return `require('${fixedPath}'`;
      }
    );
  }

  async removeUnused(filePath: string): Promise<RefactorResult> {
    if (!this.initialized) await this.initialize();

    const loadingCheck = await this.checkProjectLoaded();
    if (loadingCheck) return loadingCheck;

    const uri = await this.ensureDocumentOpen(filePath);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const params: CodeActionParams = {
      textDocument: { uri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: lines.length - 1, character: lines[lines.length - 1].length }
      },
      context: {
        diagnostics: [],
        only: ['source.removeUnused.ts']
      }
    };

    const actions = await this.connection!.sendRequest('textDocument/codeAction', params) as CodeAction[];

    if (!actions || actions.length === 0) {
      return { success: true, message: 'No unused code to remove' };
    }

    for (const action of actions) {
      if (action.edit) {
        await this.editHandler.applyWorkspaceEdit(action.edit);
      } else if (action.command) {
        await this.connection!.sendRequest('workspace/executeCommand', {
          command: action.command.command,
          arguments: action.command.arguments
        });
      }
    }

    return {
      success: true,
      message: 'Removed unused code',
      filesChanged: [filePath]
    };
  }
}