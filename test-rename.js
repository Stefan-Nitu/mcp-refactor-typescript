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

// Send initialize request
const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '1.0.0',
    capabilities: {}
  }
};

// Send tool call request for rename
const toolCallRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'typescript',
    arguments: {
      action: 'rename',
      filePath: join(__dirname, 'test', 'fixtures', 'vortex-sample.ts'),
      line: 8,  // Line with vortexQuantum variable
      column: 7, // Start of vortexQuantum
      newName: 'renamedVortexQuantum'
    }
  }
};

let responseBuffer = '';

server.stdout.on('data', (data) => {
  responseBuffer += data.toString();

  // Try to parse complete JSON-RPC messages
  const lines = responseBuffer.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim()) {
      try {
        const response = JSON.parse(lines[i]);
        console.log('Response:', JSON.stringify(response, null, 2));

        if (response.id === 1) {
          // After initialize, send the tool call
          console.log('\nSending rename request...');
          server.stdin.write(JSON.stringify(toolCallRequest) + '\n');
        } else if (response.id === 2) {
          // Tool call response received
          console.log('\nRename operation completed!');
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
console.log('Sending initialize request...');
server.stdin.write(JSON.stringify(initializeRequest) + '\n');

// Handle exit
setTimeout(() => {
  console.error('\nTimeout - no response received');
  server.kill();
  process.exit(1);
}, 30000);