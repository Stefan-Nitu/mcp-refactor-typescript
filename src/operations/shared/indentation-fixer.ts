import { IndentationDetector } from './indentation-detector.js';

export class IndentationFixer {
  constructor(private detector: IndentationDetector) {}

  fixFunctionIndentation(tsServerOutput: string, originalLines: string[], _targetLineIndex: number): string {
    if (!tsServerOutput.includes('function ')) {
      return tsServerOutput;
    }

    const projectIndentUnit = this.detector.detectIndentUnitOrDefault(originalLines);

    const textLines = tsServerOutput.split('\n');
    const funcLineIndex = textLines.findIndex(l => l.includes('function '));

    if (funcLineIndex === -1) {
      return tsServerOutput;
    }

    // TSServer extracts functions to MODULE scope (level 0)
    // We only need to fix the indent unit (4-space → project indent)
    const fixedLines = textLines.map((line) => {
      if (line.trim().length === 0) return line;

      const tsNestingLevel = this.detector.detectNestingLevel(line, '    ');

      // Function declaration at module level (0), body at their relative levels
      return this.detector.getIndentAtNestingLevel(projectIndentUnit, tsNestingLevel) + line.trimStart();
    });

    return fixedLines.join('\n');
  }

  fixConstantIndentation(tsServerOutput: string, originalLines: string[], targetLineIndex: number): string {
    if (!tsServerOutput.includes('const ')) {
      return tsServerOutput;
    }

    const projectIndentUnit = this.detector.detectIndentUnitOrDefault(originalLines);
    const textLines = tsServerOutput.split('\n');
    const constLineIndex = textLines.findIndex(l => l.includes('const '));

    if (constLineIndex === -1) {
      return tsServerOutput;
    }

    const targetLine = originalLines[targetLineIndex] || '';
    const targetNestingLevel = this.detector.detectNestingLevel(targetLine, projectIndentUnit);
    const existingIndent = this.detector.getIndentAtNestingLevel(projectIndentUnit, targetNestingLevel);

    const constLine = textLines[constLineIndex];
    textLines[constLineIndex] = constLine.replace(/^\s*/, existingIndent);

    return textLines.join('\n');
  }

  fixVariableIndentation(tsServerOutput: string, originalLines: string[], targetLineIndex: number): string {
    return this.fixConstantIndentation(tsServerOutput, originalLines, targetLineIndex);
  }
}
