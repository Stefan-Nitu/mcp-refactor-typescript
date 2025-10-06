/**
 * Processes TypeScript refactoring edits and extracts generated declaration information
 * Single Responsibility: Handle text changes and find generated declarations
 */

import type { TSTextChange } from '../language-servers/typescript/tsserver-types.js';

export type DeclarationType = 'const' | 'function';

interface DeclarationConfig {
  readonly pattern: RegExp;
}

const DECLARATION_CONFIGS: Record<DeclarationType, DeclarationConfig> = {
  const: { pattern: /const\s+(\w+)\s*=/ },
  function: { pattern: /function\s+(\w+)\s*\(/ }
};

export interface DeclarationInfo {
  name: string;
  line: number;
  column: number;
}

export class RefactoringProcessor {
  private readonly config: DeclarationConfig;

  constructor(declarationType: DeclarationType) {
    this.config = DECLARATION_CONFIGS[declarationType];
  }

  /**
   * Finds the generated declaration in TypeScript refactoring changes
   * @param changes - Array of text changes from TypeScript refactoring
   * @returns Declaration info (name, line, column) or null if not found
   */
  findDeclaration(changes: TSTextChange[]): DeclarationInfo | null {
    for (const change of changes) {
      const textLines = change.newText.split('\n');

      for (let lineIndex = 0; lineIndex < textLines.length; lineIndex++) {
        const line = textLines[lineIndex];
        const match = line.match(this.config.pattern);

        if (match && match[1]) {
          const name = match[1];
          const column = line.indexOf(name) + 1;
          const lineNumber = change.start.line + lineIndex;

          return { name, line: lineNumber, column };
        }
      }
    }

    return null;
  }

  /**
   * Updates filesChanged response after a rename operation
   * Replaces all occurrences of oldName with newName in the specified file's edits
   * @param filesChanged - The filesChanged array from refactoring response
   * @param oldName - The generated name (e.g., "newLocal", "newFunction")
   * @param newName - The custom name to replace it with
   * @param filePath - The file path to update (only updates this file)
   */
  updateFilesChangedAfterRename(
    filesChanged: Array<{ file: string; path: string; edits: Array<{ line: number; old: string; new: string }> }>,
    oldName: string,
    newName: string,
    filePath: string
  ): void {
    for (const fileChange of filesChanged) {
      if (fileChange.path === filePath) {
        for (const edit of fileChange.edits) {
          if (edit.new.includes(oldName)) {
            edit.new = edit.new.replace(
              new RegExp(`\\b${oldName}\\b`, 'g'),
              newName
            );
          }
        }
      }
    }
  }
}
