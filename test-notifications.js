#!/usr/bin/env node
import { TypeScriptLanguageServer } from './dist/tools/typescript/lsp-server.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

async function test() {
  const testDir = './test-notification-workspace';

  console.log('1. Creating project root directory...');
  await mkdir(testDir, { recursive: true });
  await mkdir(join(testDir, 'src'), { recursive: true });

  // Create tsconfig BEFORE starting server
  console.log('2. Creating tsconfig.json...');
  await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true
    },
    include: ["src/**/*"]
  }, null, 2));

  console.log('3. Starting language server with project root...');
  const server = new TypeScriptLanguageServer(testDir);
  await server.initialize();

  console.log('4. Now creating files AFTER server is running...');

  // File 1: Core utility
  await writeFile(join(testDir, 'src/lib.ts'), `
export function processData(data: string): string {
  return data.toUpperCase();
}

export function helperFunction(): void {
  const test = processData('test');
  console.log(test);
}`);

  // File 2: Service that uses lib
  await writeFile(join(testDir, 'src/service.ts'), `
import { processData } from './lib.js';

export class DataService {
  transform(input: string): string {
    return processData(input);
  }

  batchProcess(items: string[]): string[] {
    return items.map(item => processData(item));
  }
}`);

  // File 3: Another utility that uses lib
  await writeFile(join(testDir, 'src/utils.ts'), `
import { processData } from './lib.js';

export const formatMessage = (msg: string) => {
  return \`Formatted: \${processData(msg)}\`;
};

export const processMultiple = (...args: string[]) => {
  return args.map(processData);
};`);

  // File 4: Main that uses everything
  await writeFile(join(testDir, 'src/main.ts'), `
import { processData } from './lib.js';
import { DataService } from './service.js';
import { formatMessage } from './utils.js';

const service = new DataService();
const result = processData('hello');
const serviceResult = service.transform('world');
const formatted = formatMessage('test');

console.log(result, serviceResult, formatted);`);

  console.log('Waiting for any notifications...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('Opening lib.ts...');
  await server.ensureDocumentOpen(join(testDir, 'src/lib.ts'));

  console.log('Waiting for more notifications...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Attempting rename of processData to transformData...');

  // Test different positions
  console.log('\n--- Testing position at "p" in processData (column 17) ---');
  let result = await server.rename(
    join(testDir, 'src/lib.ts'),
    { line: 2, column: 17 },  // 'p' in processData
    'transformData'
  );
  console.log('Result:', result.success ? 'SUCCESS' : 'FAILED');

  // Reset files
  await writeFile(join(testDir, 'src/lib.ts'), `
export function processData(data: string): string {
  return data.toUpperCase();
}

export function helperFunction(): void {
  const test = processData('test');
  console.log(test);
}`);

  console.log('\n--- Testing position at "(" after processData (column 28) ---');
  result = await server.rename(
    join(testDir, 'src/lib.ts'),
    { line: 2, column: 28 },  // '(' after processData
    'transformData'
  );
  console.log('Result:', result.success ? 'SUCCESS' : 'FAILED');

  // Reset files
  await writeFile(join(testDir, 'src/lib.ts'), `
export function processData(data: string): string {
  return data.toUpperCase();
}

export function helperFunction(): void {
  const test = processData('test');
  console.log(test);
}`);

  console.log('\n--- Testing position at "D" in processData (column 24) ---');
  result = await server.rename(
    join(testDir, 'src/lib.ts'),
    { line: 2, column: 24 },  // 'D' in processData
    'transformData'
  );

  console.log('Rename result:', result);

  await server.shutdown();

  // Clean up test workspace
  console.log('Cleaning up test workspace...');
  await rm(testDir, { recursive: true, force: true });

  process.exit(0);
}

test().catch(console.error);