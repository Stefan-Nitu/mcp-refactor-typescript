/**
 * Updates string literal paths when files are renamed/moved
 * Finds all string literals matching the old path and updates them
 * More robust than pattern matching - catches mocks, requires, dynamic imports, etc.
 */

import { dirname, relative } from 'path';

export class StringLiteralPathUpdater {
  findMockPathUpdates(
    fileContent: string,
    filePath: string,
    oldFilePath: string,
    newFilePath: string
  ): Array<{ line: number; column: number; old: string; new: string }> {
    const lines = fileContent.split('\n');
    const updates: Array<{ line: number; column: number; old: string; new: string }> = [];

    const oldRelativePath = this.getRelativeImportPath(filePath, oldFilePath);
    const newRelativePath = this.getRelativeImportPath(filePath, newFilePath);

    if (oldRelativePath === newRelativePath) {
      return updates;
    }

    const stringLiteralPattern = /(['"])(.+?)\1/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      if (/^\s*(import|export)\s/.test(line)) {
        continue;
      }

      const regex = new RegExp(stringLiteralPattern.source, stringLiteralPattern.flags);
      let match;

      while ((match = regex.exec(line)) !== null) {
        const quotedPath = match[2];

        if (quotedPath === oldRelativePath) {
          updates.push({
            line: lineIndex + 1,
            column: match.index + 1 + 1,
            old: quotedPath,
            new: newRelativePath
          });
        }
      }
    }

    return updates;
  }

  private getRelativeImportPath(fromFile: string, toFile: string): string {
    const fromDir = dirname(fromFile);
    let relativePath = relative(fromDir, toFile);

    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath;
    }

    relativePath = relativePath.replace(/\\/g, '/');

    relativePath = relativePath.replace(/\.tsx?$/, '.js');

    return relativePath;
  }
}
