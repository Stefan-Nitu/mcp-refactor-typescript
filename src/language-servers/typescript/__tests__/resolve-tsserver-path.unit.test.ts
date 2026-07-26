/**
 * Tests for locating the tsserver.js that gets spawned.
 *
 * The failure these cover shipped in 2.1.0: the path was resolved against
 * process.cwd() with `typescript` only a devDependency, so a fresh install had
 * no tsserver to spawn and every operation hung until its 30s request timeout.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTsserverPath } from '../resolve-tsserver-path.js';

const createdDirs: string[] = [];

async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-refactor-project-'));
  createdDirs.push(dir);
  return dir;
}

/** Stands in for TypeScript 7, whose exports map no longer offers lib/tsserver.js */
async function installTypeScriptWithoutTsserver(projectDir: string) {
  const packageDir = join(projectDir, 'node_modules', 'typescript');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: 'typescript',
      version: '7.0.2',
      exports: { './package.json': './package.json' },
    }),
    'utf-8',
  );
}

afterEach(async () => {
  await Promise.all(
    createdDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('resolveTsserverPath', () => {
  it('should use the TypeScript installed in the project being refactored', () => {
    // Arrange - this repo has typescript in its own node_modules
    const projectPath = process.cwd();

    // Act
    const tsserverPath = resolveTsserverPath(projectPath);

    // Assert
    expect(tsserverPath).toBe(
      join(projectPath, 'node_modules', 'typescript', 'lib', 'tsserver.js'),
    );
  });

  it('should fall back to the bundled TypeScript when the project has none', async () => {
    // Arrange
    const projectPath = await makeProjectDir();

    // Act
    const tsserverPath = resolveTsserverPath(projectPath);

    // Assert
    expect(existsSync(tsserverPath)).toBe(true);
    expect(tsserverPath).toBe(
      createRequire(import.meta.url).resolve('typescript/lib/tsserver.js'),
    );
  });

  it('should fall back when the project TypeScript does not expose tsserver', async () => {
    // Arrange
    const projectPath = await makeProjectDir();
    await installTypeScriptWithoutTsserver(projectPath);

    // Act
    const tsserverPath = resolveTsserverPath(projectPath);

    // Assert
    expect(existsSync(tsserverPath)).toBe(true);
    expect(tsserverPath).not.toContain(projectPath);
  });
});
