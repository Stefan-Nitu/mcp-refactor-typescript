import type { TSTextChange } from '../../language-servers/typescript/tsserver-types.js';

export interface FileEdit {
  line: number;
  column?: number;
  old: string;
  new: string;
}

export interface FileChanges {
  file: string;
  path: string;
  edits: FileEdit[];
}

export class EditApplicator {
  sortEdits(changes: TSTextChange[]): TSTextChange[] {
    return [...changes].sort((a, b) => {
      if (b.start.line !== a.start.line) {
        return b.start.line - a.start.line;
      }
      return b.start.offset - a.start.offset;
    });
  }

  applyEdits(lines: string[], changes: TSTextChange[]): string[] {
    const result = [...lines];

    for (const change of changes) {
      const startLine = change.start.line - 1;
      const endLine = change.end.line - 1;
      const startOffset = change.start.offset - 1;
      const endOffset = change.end.offset - 1;

      if (startLine === endLine) {
        result[startLine] =
          result[startLine].substring(0, startOffset) +
          change.newText +
          result[startLine].substring(endOffset);
      } else {
        const before = result[startLine].substring(0, startOffset);
        const after = result[endLine].substring(endOffset);
        result.splice(startLine, endLine - startLine + 1, before + change.newText + after);
      }
    }

    return result;
  }

  buildFileChanges(
    originalLines: string[],
    changes: TSTextChange[],
    filePath: string
  ): FileChanges {
    const edits: FileEdit[] = [];

    for (const change of changes) {
      const startLine = change.start.line - 1;
      const endLine = change.end.line - 1;
      const startOffset = change.start.offset - 1;
      const endOffset = change.end.offset - 1;

      const oldText = startLine === endLine
        ? originalLines[startLine].substring(startOffset, endOffset)
        : this.extractMultiLineText(originalLines, startLine, startOffset, endLine, endOffset);

      edits.push({
        line: change.start.line,
        column: change.start.offset,
        old: oldText,
        new: change.newText
      });
    }

    return {
      file: filePath.split('/').pop() || filePath,
      path: filePath,
      edits
    };
  }

  private extractMultiLineText(
    lines: string[],
    startLine: number,
    startOffset: number,
    endLine: number,
    endOffset: number
  ): string {
    const parts: string[] = [];

    for (let i = startLine; i <= endLine; i++) {
      if (i === startLine) {
        parts.push(lines[i].substring(startOffset));
      } else if (i === endLine) {
        parts.push(lines[i].substring(0, endOffset));
      } else {
        parts.push(lines[i]);
      }
    }

    return parts.join('\n');
  }
}
