import { randomBytes } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createTestDir(): string {
  return join(__dirname, `../../../.test-workspace-${randomBytes(8).toString('hex')}`);
}

export interface TestContext {
  testDir: string;
  server: TypeScriptServer | null;
}

/**
 * Setup test workspace and tsconfig before all tests
 */
export async function setupTestWorkspace(testDir: string): Promise<void> {
  await mkdir(testDir, { recursive: true });

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      jsx: "react"
    },
    include: ["src/**/*"]
  };
  await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');
}

/**
 * Cleanup test workspace after all tests
 */
export async function cleanupTestWorkspace(testDir: string): Promise<void> {
  await rm(testDir, { recursive: true, force: true });
}

/**
 * Prepare clean src directory and fresh TypeScript server before each test
 */
export async function setupTestCase(testDir: string, TypeScriptServerClass: new () => TypeScriptServer): Promise<TypeScriptServer> {
  await rm(join(testDir, 'src'), { recursive: true, force: true }).catch(() => {});
  await mkdir(join(testDir, 'src'), { recursive: true });

  const server = new TypeScriptServerClass();
  await server.start(testDir);
  return server;
}

/**
 * Stop TypeScript server after each test
 */
export async function cleanupTestCase(server: TypeScriptServer | null): Promise<void> {
  if (server?.isRunning()) {
    await server.stop();
  }
}
