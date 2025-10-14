export class IndentationDetector {
  private readonly DEFAULT_INDENT = '  ';

  detectIndentUnitOrDefault(lines: string[]): string {
    const detected = this.detectIndentUnit(lines);
    return detected || this.DEFAULT_INDENT;
  }

  detectIndentUnit(lines: string[]): string {
    const indentCounts = new Map<string, number>();
    let previousIndent: string | null = null;

    for (const line of lines) {
      if (line.trim().length === 0) continue;

      const currentIndent = this.extractIndent(line);
      if (currentIndent === null) continue;

      if (previousIndent !== null && currentIndent !== previousIndent) {
        const diff = this.calculateIndentDifference(previousIndent, currentIndent);
        if (diff && (diff.length > 1 || diff === '\t')) {
          indentCounts.set(diff, (indentCounts.get(diff) || 0) + 1);
        }
      }

      previousIndent = currentIndent;
    }

    if (indentCounts.size === 0) {
      return '';
    }

    let mostCommon = '';
    let maxCount = 0;

    for (const [indent, count] of indentCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = indent;
      }
    }

    return mostCommon || this.DEFAULT_INDENT;
  }

  getIndentAtNestingLevel(indentUnit: string, level: number): string {
    if (level === 0 || !indentUnit) return '';
    return indentUnit.repeat(level);
  }

  detectNestingLevel(line: string, indentUnit: string): number {
    if (!line || line.trim().length === 0) return 0;
    if (!indentUnit) return 0;

    const lineIndent = this.extractIndent(line);
    if (lineIndent === null || lineIndent === '') return 0;

    if (indentUnit === '\t') {
      return lineIndent.split('\t').length - 1;
    }

    return Math.floor(lineIndent.length / indentUnit.length);
  }

  private extractIndent(line: string): string | null {
    if (line.trim().length === 0) return null;

    const match = line.match(/^(\s+)/);
    if (!match) return '';
    return match[1];
  }

  private calculateIndentDifference(prevIndent: string, currentIndent: string): string {
    if (currentIndent.length > prevIndent.length) {
      return currentIndent.substring(prevIndent.length);
    }

    if (prevIndent.length > currentIndent.length) {
      return prevIndent.substring(currentIndent.length);
    }

    return '';
  }
}
