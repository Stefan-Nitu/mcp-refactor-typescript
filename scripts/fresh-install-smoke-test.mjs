#!/usr/bin/env node

/**
 * Packs the server, installs the tarball into a throwaway directory, and drives a
 * real refactor against a project that has no TypeScript of its own.
 *
 * Version 2.1.0 shipped broken because every other test runs inside this repo,
 * where node_modules/typescript is always present. This one runs outside it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf-8', stdio: 'pipe' });
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const workDir = await mkdtemp(join(tmpdir(), 'mcp-refactor-smoke-'));
const installDir = join(workDir, 'install');
const projectDir = join(workDir, 'project');

try {
  console.log('Packing the server...');
  const packed = JSON.parse(
    run('npm', ['pack', '--json', '--pack-destination', workDir], repoRoot),
  );
  const tarball = join(workDir, packed[0].filename);

  console.log('Installing the tarball into a clean directory...');
  await mkdir(installDir, { recursive: true });
  await writeFile(
    join(installDir, 'package.json'),
    JSON.stringify({ name: 'smoke-test-host', version: '1.0.0', private: true }),
  );
  run('npm', ['install', tarball, '--no-audit', '--no-fund'], installDir);

  // tsr declares typescript as a peer dependency of >=4.0.0, so npm will happily
  // resolve it to TypeScript 7 — which no longer ships lib/tsserver.js at all
  const require = createRequire(join(installDir, 'package.json'));
  const tsserverPath = require.resolve('typescript/lib/tsserver.js');
  const tsVersion = JSON.parse(
    await readFile(require.resolve('typescript/package.json'), 'utf-8'),
  ).version;
  console.log(`Bundled TypeScript: ${tsVersion}`);
  if (!tsVersion.startsWith('5.')) {
    fail(`expected a TypeScript 5.x runtime, resolved ${tsVersion}`);
  }
  if (!existsSync(tsserverPath)) {
    fail(`no tsserver at ${tsserverPath}`);
  }

  console.log('Building a project with no TypeScript installed...');
  await mkdir(join(projectDir, 'src'), { recursive: true });
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'smoke-test-project', version: '1.0.0', private: true }),
  );
  await writeFile(
    join(projectDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true },
      include: ['src'],
    }),
  );
  await writeFile(
    join(projectDir, 'src', 'app.ts'),
    'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n\ngreet("world");\n',
  );

  const { Client } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href
  );
  const { StdioClientTransport } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
  );

  console.log('Renaming a symbol through the MCP protocol...');
  const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: 'node',
      args: [require.resolve('mcp-refactor-typescript/dist/index.js')],
      cwd: projectDir,
    }),
  );

  const response = await client.callTool({
    name: 'refactoring',
    arguments: {
      operation: 'rename',
      filePath: join(projectDir, 'src', 'app.ts'),
      line: 1,
      text: 'greet',
      name: 'salute',
    },
  });
  await client.close();

  const result = JSON.parse(response.content[0].text);
  console.log(`Server responded: ${result.status} — ${result.message}`);
  if (result.status !== 'success') {
    fail(`rename returned "${result.status}": ${result.message}`);
  }

  const renamed = await readFile(join(projectDir, 'src', 'app.ts'), 'utf-8');
  if (!renamed.includes('function salute') || renamed.includes('function greet')) {
    fail(`the file was not rewritten:\n${renamed}`);
  }

  if (process.exitCode !== 1) {
    console.log('PASS: a fresh install refactors a project that has no TypeScript');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
