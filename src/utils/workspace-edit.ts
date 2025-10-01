import { WorkspaceEdit, TextEdit, CreateFile, RenameFile, DeleteFile, TextDocumentEdit } from 'vscode-languageserver-protocol';
import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { dirname, basename } from 'path';
import { fileURLToPath } from 'url';

export interface EditDetail {
  filePath: string;
  edits: Array<{
    line: number;
    oldText: string;
    newText: string;
  }>;
}

export class WorkspaceEditHandler {
  private editDetails: EditDetail[] = [];

  async applyWorkspaceEdit(edit: WorkspaceEdit): Promise<string[]> {
    const filesChanged: Set<string> = new Set();
    this.editDetails = [];

    // Handle document changes (newer format)
    if (edit.documentChanges) {
      for (const change of edit.documentChanges) {
        if (TextDocumentEdit.is(change)) {
          const filePath = fileURLToPath(change.textDocument.uri);
          await this.applyTextEdits(filePath, change.edits as TextEdit[]);
          filesChanged.add(filePath);
        } else if (CreateFile.is(change)) {
          const filePath = fileURLToPath(change.uri);
          await this.createFile(filePath, change.options);
          filesChanged.add(filePath);
        } else if (RenameFile.is(change)) {
          const oldPath = fileURLToPath(change.oldUri);
          const newPath = fileURLToPath(change.newUri);
          await this.renameFile(oldPath, newPath, change.options);
          filesChanged.add(oldPath);
          filesChanged.add(newPath);
        } else if (DeleteFile.is(change)) {
          const filePath = fileURLToPath(change.uri);
          await this.deleteFile(filePath, change.options);
          filesChanged.add(filePath);
        }
      }
    }

    // Handle changes (older format)
    if (edit.changes) {
      for (const [uri, textEdits] of Object.entries(edit.changes)) {
        const filePath = fileURLToPath(uri);
        await this.applyTextEdits(filePath, textEdits);
        filesChanged.add(filePath);
      }
    }

    return Array.from(filesChanged);
  }

  getEditDetails(): EditDetail[] {
    return this.editDetails;
  }

  private async applyTextEdits(filePath: string, edits: TextEdit[]): Promise<void> {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const fileEditDetail: EditDetail = {
      filePath,
      edits: []
    };

    // Sort edits in reverse order to maintain positions
    const sortedEdits = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) {
        return b.range.start.line - a.range.start.line;
      }
      return b.range.start.character - a.range.start.character;
    });

    for (const edit of sortedEdits) {
      const startLine = edit.range.start.line;
      const endLine = edit.range.end.line;
      const startChar = edit.range.start.character;
      const endChar = edit.range.end.character;

      if (startLine === endLine) {
        // Single line edit
        const line = lines[startLine];
        const oldText = line.substring(startChar, endChar);

        // Only record if this looks like a valid identifier rename
        // This helps debug issues where the language server sends bad edits
        if (oldText && edit.newText) {
          fileEditDetail.edits.push({
            line: startLine + 1, // Convert to 1-based
            oldText: oldText || '<empty>',
            newText: edit.newText
          });
        }

        lines[startLine] =
          line.substring(0, startChar) +
          edit.newText +
          line.substring(endChar);
      } else {
        // Multi-line edit
        const startLineText = lines[startLine].substring(0, startChar);
        const endLineText = lines[endLine].substring(endChar);
        const oldText = lines.slice(startLine, endLine + 1).join('\n');
        const newLines = edit.newText.split('\n');

        fileEditDetail.edits.push({
          line: startLine + 1, // Convert to 1-based
          oldText: oldText.substring(startChar, oldText.length - endLineText.length),
          newText: edit.newText
        });

        newLines[0] = startLineText + newLines[0];
        newLines[newLines.length - 1] = newLines[newLines.length - 1] + endLineText;

        lines.splice(startLine, endLine - startLine + 1, ...newLines);
      }
    }

    if (fileEditDetail.edits.length > 0) {
      this.editDetails.push(fileEditDetail);
    }

    await writeFile(filePath, lines.join('\n'), 'utf-8');
  }

  private async createFile(filePath: string, options?: { overwrite?: boolean; ignoreIfExists?: boolean }): Promise<void> {
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, '', { flag: options?.overwrite ? 'w' : 'wx' });
    } catch (error: any) {
      if (error.code === 'EEXIST' && options?.ignoreIfExists) {
        return;
      }
      throw error;
    }
  }

  private async renameFile(oldPath: string, newPath: string, options?: { overwrite?: boolean; ignoreIfExists?: boolean }): Promise<void> {
    try {
      await mkdir(dirname(newPath), { recursive: true });
      await rename(oldPath, newPath);
    } catch (error: any) {
      if (error.code === 'EEXIST' && options?.ignoreIfExists) {
        return;
      }
      throw error;
    }
  }

  private async deleteFile(filePath: string, options?: { recursive?: boolean; ignoreIfNotExists?: boolean }): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT' && options?.ignoreIfNotExists) {
        return;
      }
      throw error;
    }
  }
}