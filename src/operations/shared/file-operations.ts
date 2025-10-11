import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

export class FileOperations {
  async readLines(filePath: string): Promise<string[]> {
    const content = await readFile(filePath, 'utf8');
    return content.split('\n');
  }

  async writeLines(filePath: string, lines: string[]): Promise<void> {
    const content = lines.join('\n');
    await writeFile(filePath, content, 'utf8');
  }

  resolvePath(filePath: string): string {
    return resolve(filePath);
  }
}
