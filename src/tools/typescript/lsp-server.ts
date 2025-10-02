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
import { readFile } from 'fs/promises';
import { pathToFileURL, fileURLToPath } from 'url';
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
    const tsserver = spawn('npx', ['tsserver'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: true,
      cwd: rootPath
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

  private async checkProjectLoaded(waitTime = 5000): Promise<RefactorResult | null> {
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

    const workspaceEdit: WorkspaceEdit | null = await this.connection!.sendRequest('textDocument/rename', {
      textDocument: { uri },
      position: lspPosition,
      newName
    });

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

    const extractAction = actions?.find(a =>
      a.title.toLowerCase().includes('function') ||
      a.title.toLowerCase().includes('method')
    );

    if (!extractAction) {
      return { success: false, message: 'No extract function action available' };
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
      arguments: [{ sourceUri: uri }]
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

    const sourceUri = pathToFileURL(sourcePath).toString();
    const destUri = pathToFileURL(destinationPath).toString();

    const workspaceEdit: WorkspaceEdit | null = await this.connection!.sendRequest('workspace/willRenameFiles', {
      files: [{
        oldUri: sourceUri,
        newUri: destUri
      }]
    });

    if (workspaceEdit) {
      const filesChanged = await this.editHandler.applyWorkspaceEdit(workspaceEdit);
      const editDetails = this.editHandler.getEditDetails();

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
}