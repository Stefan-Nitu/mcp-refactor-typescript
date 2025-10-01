#!/usr/bin/env node
import { rename } from './dist/tools/typescript/rename.js';
import { initializeLanguageServer } from './dist/tools/typescript/lsp-manager.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';

async function setupTestEnvironment() {
  const testDir = './test-rename-workspace';

  console.log('Setting up test environment...');
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
  await mkdir(join(testDir, 'src'), { recursive: true });

  // Create tsconfig
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true
    },
    include: ["src/**/*"]
  };
  await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');

  // Initialize the global language server with test directory
  await initializeLanguageServer(testDir);

  return testDir;
}

async function testSingleFileRename(testDir) {
  console.log('\n=== TEST 1: Single File Rename ===');

  const filePath = join(testDir, 'src', 'single.ts');
  const content = `function calculateSum(a: number, b: number): number {
  return a + b;
}

function testCalculation() {
  const result = calculateSum(5, 3);
  console.log(calculateSum(10, 20));
  return result;
}

export { calculateSum };`;

  await writeFile(filePath, content, 'utf-8');
  await new Promise(resolve => setTimeout(resolve, 500)); // Let LSP index

  // Test rename - point at 'calculateSum' on line 1
  console.log('Renaming calculateSum to computeTotal...');
  const result = await rename(filePath, 1, 10, 'computeTotal');

  const response = JSON.parse(result.content[0].text);
  console.log('Status:', response.status);
  console.log('Message:', response.message);
  console.log('Files changed:', response.filesChanged?.length || 0);

  if (response.changes) {
    console.log('Changes:');
    response.changes.forEach(change => {
      console.log(`  ${change.file}:`);
      change.edits.forEach(edit => {
        console.log(`    Line ${edit.line}: "${edit.old}" → "${edit.new}"`);
      });
    });
  }

  // Verify the file was actually updated
  const updatedContent = await readFile(filePath, 'utf-8');
  const occurrences = (updatedContent.match(/computeTotal/g) || []).length;
  console.log(`✓ Found ${occurrences} occurrences of 'computeTotal' in file`);

  return response.status === 'success' && occurrences === 3;
}

async function testCrossFileRename(testDir) {
  console.log('\n=== TEST 2: Cross-File Rename ===');

  // Create multiple files with dependencies
  const libPath = join(testDir, 'src', 'lib.ts');
  const servicePath = join(testDir, 'src', 'service.ts');
  const mainPath = join(testDir, 'src', 'main.ts');

  await writeFile(libPath, `export function processData(input: string): string {
  return input.toUpperCase();
}

export function helperFunction() {
  return processData('test');
}`, 'utf-8');

  await writeFile(servicePath, `import { processData } from './lib.js';

export class DataService {
  transform(data: string) {
    return processData(data);
  }

  batch(items: string[]) {
    return items.map(item => processData(item));
  }
}`, 'utf-8');

  await writeFile(mainPath, `import { processData } from './lib.js';
import { DataService } from './service.js';

const service = new DataService();
console.log(processData('hello'));
console.log(service.transform('world'));`, 'utf-8');

  await new Promise(resolve => setTimeout(resolve, 500)); // Let LSP index

  // Rename processData to transformData
  console.log('Renaming processData to transformData...');
  const result = await rename(libPath, 1, 17, 'transformData');

  const response = JSON.parse(result.content[0].text);
  console.log('Status:', response.status);
  console.log('Files changed:', response.filesChanged?.length || 0);

  if (response.summary) {
    console.log('Summary:', response.summary);
  }

  // Verify all files were updated
  const libContent = await readFile(libPath, 'utf-8');
  const serviceContent = await readFile(servicePath, 'utf-8');
  const mainContent = await readFile(mainPath, 'utf-8');

  const libCount = (libContent.match(/transformData/g) || []).length;
  const serviceCount = (serviceContent.match(/transformData/g) || []).length;
  const mainCount = (mainContent.match(/transformData/g) || []).length;

  console.log(`✓ lib.ts: ${libCount} occurrences of 'transformData'`);
  console.log(`✓ service.ts: ${serviceCount} occurrences of 'transformData'`);
  console.log(`✓ main.ts: ${mainCount} occurrences of 'transformData'`);

  return response.status === 'success' && libCount === 2 && serviceCount === 3 && mainCount === 2;
}

async function testEdgeCases(testDir) {
  console.log('\n=== TEST 3: Edge Cases ===');

  const filePath = join(testDir, 'src', 'edge.ts');
  const content = `// Test with comments and strings
function getValue(): string {
  // getValue is a helper function
  return "getValue returns this string";
}

const description = "The getValue function is useful";
console.log(getValue());
/* Multi-line comment
   getValue should not be renamed here
*/
const obj = {
  getValue: () => "different function"
};`;

  await writeFile(filePath, content, 'utf-8');
  await new Promise(resolve => setTimeout(resolve, 500));

  // Rename the function getValue (not the string or comment occurrences)
  console.log('Renaming getValue function to fetchValue...');
  const result = await rename(filePath, 2, 10, 'fetchValue');

  const response = JSON.parse(result.content[0].text);
  console.log('Status:', response.status);

  if (response.changes) {
    console.log('Changes made:');
    response.changes.forEach(change => {
      change.edits.forEach(edit => {
        console.log(`  Line ${edit.line}: "${edit.old}" → "${edit.new}"`);
      });
    });
  }

  const updatedContent = await readFile(filePath, 'utf-8');

  // Check what was renamed
  const functionRenamed = updatedContent.includes('function fetchValue');
  const callRenamed = updatedContent.includes('console.log(fetchValue()');
  const stringNotRenamed = updatedContent.includes('"getValue returns this string"');
  const commentNotRenamed = updatedContent.includes('// getValue is a helper');
  const differentFunctionNotRenamed = updatedContent.includes('getValue: () =>');

  console.log(`✓ Function declaration renamed: ${functionRenamed}`);
  console.log(`✓ Function call renamed: ${callRenamed}`);
  console.log(`✓ String literal NOT renamed: ${stringNotRenamed}`);
  console.log(`✓ Comment NOT renamed: ${commentNotRenamed}`);
  console.log(`✓ Different getValue NOT renamed: ${differentFunctionNotRenamed}`);

  return functionRenamed && callRenamed && stringNotRenamed && commentNotRenamed && differentFunctionNotRenamed;
}

async function runTests() {
  let allTestsPassed = true;

  try {
    const testDir = await setupTestEnvironment();

    // Run tests
    const test1 = await testSingleFileRename(testDir);
    allTestsPassed = allTestsPassed && test1;

    const test2 = await testCrossFileRename(testDir);
    allTestsPassed = allTestsPassed && test2;

    const test3 = await testEdgeCases(testDir);
    allTestsPassed = allTestsPassed && test3;

    // Cleanup
    // Note: We can't shutdown the singleton server here as it would break future tests
    await rm(testDir, { recursive: true, force: true });

    console.log('\n' + '='.repeat(50));
    if (allTestsPassed) {
      console.log('✅ ALL TESTS PASSED');
    } else {
      console.log('❌ SOME TESTS FAILED');
      process.exit(1);
    }
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  }
}

runTests();