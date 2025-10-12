export class IndentationDetector {
  private readonly SEARCH_WINDOW = 3;
  private readonly DEFAULT_INDENT = '  ';

  detect(lines: string[], targetLine: number): string {
    const targetIndent = this.extractIndent(lines[targetLine]);
    if (targetIndent !== null && targetIndent !== '') return targetIndent;

    const forwardIndent = this.searchForward(lines, targetLine + 1);
    if (forwardIndent !== null) return forwardIndent;

    const backwardIndent = this.searchBackward(lines, targetLine);
    if (backwardIndent !== null) return backwardIndent;

    if (targetIndent === '') return '';

    return this.DEFAULT_INDENT;
  }

  private searchForward(lines: string[], startLine: number): string | null {
    const endLine = Math.min(startLine + this.SEARCH_WINDOW, lines.length);

    for (let i = startLine; i < endLine; i++) {
      const indent = this.extractIndent(lines[i]);
      if (indent !== null) return indent;
    }

    return null;
  }

  private searchBackward(lines: string[], startLine: number): string | null {
    const beginLine = Math.max(0, startLine - this.SEARCH_WINDOW);

    for (let i = startLine - 1; i >= beginLine; i--) {
      const indent = this.extractIndent(lines[i]);
      if (indent !== null) return indent;
    }

    return null;
  }

  private extractIndent(line: string): string | null {
    if (line.trim().length === 0) return null;

    const match = line.match(/^(\s+)/);
    if (!match) return '';
    return match[1];
  }
}
