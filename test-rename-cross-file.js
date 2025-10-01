#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Start the MCP server
const server = spawn('node', [join(__dirname, 'dist', 'index.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Handle server stderr (logs)
server.stderr.on('data', (data) => {
  console.error('[Server Log]', data.toString());
});

// Initialize request
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '1.0.0',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};

// First, let's open the files that reference the method
const openQuasarFile = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'typescript',
    arguments: {
      action: 'organize_imports', // Just to open the file
      filePath: join(__dirname, 'test', 'fixtures', 'quasar-entry.ts')
    }
  }
};

const openServiceFile = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    name: 'typescript',
    arguments: {
      action: 'organize_imports', // Just to open the file
      filePath: join(__dirname, 'test', 'fixtures', 'services', 'zephyr-service.ts')
    }
  }
};

// Then rename the method
const renameRequest = {
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: {
    name: 'typescript',
    arguments: {
      action: 'rename',
      filePath: join(__dirname, 'test', 'fixtures', 'models', 'zephyr.ts'),
      line: 25,
      column: 3,
      newName: 'getZephyrFullName'
    }
  }
};

let responseBuffer = '';
let currentRequestId = 1;

server.stdout.on('data', (data) => {
  responseBuffer += data.toString();

  // Try to parse complete JSON-RPC messages
  const lines = responseBuffer.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim()) {
      try {
        const response = JSON.parse(lines[i]);

        if (response.id === 1) {
          console.log('✓ Initialized');
          console.log('\nOpening quasar-entry.ts...');
          server.stdin.write(JSON.stringify(openQuasarFile) + '\n');
        } else if (response.id === 2) {
          console.log('✓ Opened quasar-entry.ts');
          console.log('\nOpening zephyr-service.ts...');
          server.stdin.write(JSON.stringify(openServiceFile) + '\n');
        } else if (response.id === 3) {
          console.log('✓ Opened zephyr-service.ts');
          console.log('\nNow renaming getZephyrDisplayName to getZephyrFullName...\n');
          server.stdin.write(JSON.stringify(renameRequest) + '\n');
        } else if (response.id === 4) {
          console.log('Rename Response:');
          if (response.result && response.result.content && response.result.content[0]) {
            const result = JSON.parse(response.result.content[0].text);
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(JSON.stringify(response, null, 2));
          }

          server.stdin.end();
          process.exit(0);
        }
      } catch (e) {
        // Not a complete JSON message yet
      }
    }
  }
  responseBuffer = lines[lines.length - 1];
});

// Send initialize request
console.log('Initializing...');
server.stdin.write(JSON.stringify(initRequest) + '\n');

// Handle timeout
setTimeout(() => {
  console.error('\nTimeout - no response received');
  server.kill();
  process.exit(1);
}, 60000);