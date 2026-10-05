interface Position {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

type PositionResult =
  | ({ success: true } & Position)
  | { success: false; message: string };

// TypeScript names may contain any Unicode letter, so an ASCII class would let
// `x` match inside `Δx`. JavaScript also allows `$`, which ID_Continue omits.
const STARTS_WITH_IDENTIFIER_CHAR = /^[\p{ID_Continue}$]/u;
const ENDS_WITH_IDENTIFIER_CHAR = /[\p{ID_Continue}$]$/u;

export class TextPositionConverter {
  findTextPosition(
    lines: string[],
    line: number,
    text: string,
  ): PositionResult {
    const lineIndex = line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return {
        success: false,
        message: `Line ${line} is out of range (file has ${lines.length} lines)`,
      };
    }

    const lineContent = lines[lineIndex];
    let textIndex = lineContent.indexOf(text);

    if (textIndex === -1) {
      return {
        success: false,
        message: `Text "${text}" not found on line ${line}

Line content: ${lineContent}

Try:
  1. Check the text matches exactly (case-sensitive)
  2. Ensure you're on the correct line`,
      };
    }

    while (
      textIndex !== -1 &&
      this.isPartOfLongerIdentifier(lineContent, textIndex, text)
    ) {
      textIndex = lineContent.indexOf(text, textIndex + 1);
    }

    if (textIndex === -1) {
      return {
        success: false,
        message: `Text "${text}" only appears as part of a longer identifier on line ${line}

Line content: ${lineContent}

Try:
  1. Use the whole identifier, not part of it
  2. Ensure you're on the correct line`,
      };
    }

    return {
      success: true,
      startLine: line,
      startColumn: textIndex + 1,
      endLine: line,
      endColumn: textIndex + text.length + 1,
    };
  }

  /**
   * Only an end of `text` that is itself an identifier character can run into
   * a neighbour, so a selection such as `(a, b)` still matches right after `add`
   */
  private isPartOfLongerIdentifier(
    lineContent: string,
    index: number,
    text: string,
  ): boolean {
    const joinsPrevious =
      STARTS_WITH_IDENTIFIER_CHAR.test(text) &&
      ENDS_WITH_IDENTIFIER_CHAR.test(lineContent.slice(0, index));
    const joinsNext =
      ENDS_WITH_IDENTIFIER_CHAR.test(text) &&
      STARTS_WITH_IDENTIFIER_CHAR.test(lineContent.slice(index + text.length));
    return joinsPrevious || joinsNext;
  }
}
