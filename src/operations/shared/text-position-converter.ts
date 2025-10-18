interface Position {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

type PositionResult =
  | { success: true } & Position
  | { success: false; message: string };

export class TextPositionConverter {
  findTextPosition(lines: string[], line: number, text: string): PositionResult {
    const lineIndex = line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return {
        success: false,
        message: `Line ${line} is out of range (file has ${lines.length} lines)`
      };
    }

    const lineContent = lines[lineIndex];
    const textIndex = lineContent.indexOf(text);

    if (textIndex === -1) {
      return {
        success: false,
        message: `Text "${text}" not found on line ${line}

Line content: ${lineContent}

Try:
  1. Check the text matches exactly (case-sensitive)
  2. Ensure you're on the correct line`
      };
    }

    return {
      success: true,
      startLine: line,
      startColumn: textIndex + 1,
      endLine: line,
      endColumn: textIndex + text.length + 1
    };
  }
}
