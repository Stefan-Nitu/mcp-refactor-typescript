# MCP Server Architecture Guide (TypeScript)

## Overview

This guide presents the recommended architecture for building TypeScript MCP (Model Context Protocol) servers based on official SDK patterns and industry best practices for 2024-2025.

## Core Architecture Principles

### 1. Component-Based Design
MCP servers are built around three primary components that enable AI interactions:

- **Tools**: Actions the AI can execute (build, test, deploy)
- **Resources**: Read-only data the AI can access (status, configurations)
- **Prompts**: Reusable templates for common interactions

### 2. Modular Server Structure

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

class XcodeMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: 'xcode-server', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    this.registerComponents();
  }

  private registerComponents() {
    this.registerTools();
    this.registerResources();
    this.registerPrompts();
  }
}
```

## Recommended Project Structure

### Standard Structure (Multiple Tools)

```
src/
├── index.ts                 # Server initialization and startup
├── server.ts               # Main server class
├── tools/                  # Tool implementations
│   ├── index.ts           # Tool exports and registration
│   ├── build.ts           # Build-related tools
│   ├── simulator.ts       # Simulator management tools
│   └── test.ts            # Testing tools
├── resources/             # Resource handlers
│   ├── index.ts          # Resource exports
│   └── status.ts         # Status resources
├── prompts/              # Prompt templates
│   └── index.ts         # Prompt definitions
├── schemas/              # Validation schemas
│   ├── tools.ts         # Tool input schemas
│   └── resources.ts     # Resource schemas
├── utils/                # Shared utilities
│   ├── exec.ts          # Command execution
│   ├── format.ts        # Output formatting
│   └── cache.ts         # Caching utilities
└── types/                # TypeScript definitions
    └── index.ts         # Shared types
```

### Compact Structure (Few Tools)

```
src/
├── index.ts              # Server class and tool implementations
├── schemas.ts           # All validation schemas
├── utils.ts            # Utility functions
└── types.ts           # Type definitions
```

## Implementation Patterns

### Tool Implementation

Tools perform actions and computations:

```typescript
// tools/build.ts
import { z } from 'zod';
import { executeCommand } from '../utils/exec.js';

export const buildToolSchema = z.object({
  projectPath: z.string().describe('Path to Xcode project'),
  scheme: z.string().describe('Build scheme'),
  configuration: z.string().default('Debug').describe('Build configuration')
});

export async function buildTool(args: z.infer<typeof buildToolSchema>) {
  const { projectPath, scheme, configuration } = args;

  const command = [
    'xcodebuild',
    '-project', projectPath,
    '-scheme', scheme,
    '-configuration', configuration
  ];

  const result = await executeCommand(command);

  return {
    content: [{
      type: 'text',
      text: formatBuildOutput(result)
    }]
  };
}

// Tool registration in server
this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'build_xcode':
      const validated = buildToolSchema.parse(args);
      return await buildTool(validated);
    // ... other tools
  }
});
```

### Resource Implementation

Resources provide read-only access to data:

```typescript
// resources/status.ts
export async function getSimulatorStatus() {
  const simulators = await fetchSimulatorList();

  return {
    uri: 'simulator://status',
    mimeType: 'application/json',
    text: JSON.stringify({
      total: simulators.length,
      booted: simulators.filter(s => s.state === 'Booted').length,
      devices: simulators
    })
  };
}

// Resource registration
this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'simulator://status',
      name: 'Simulator Status',
      description: 'Current simulator states',
      mimeType: 'application/json'
    }
  ]
}));
```

### Prompt Implementation

Prompts provide reusable interaction templates:

```typescript
// prompts/index.ts
export const prompts = [
  {
    name: 'analyze_build_error',
    description: 'Analyze Xcode build errors',
    arguments: [
      {
        name: 'error_log',
        description: 'The build error output',
        required: true
      }
    ],
    template: (args: { error_log: string }) => `
      Analyze this Xcode build error and suggest solutions:

      ${args.error_log}

      Please provide:
      1. Root cause analysis
      2. Suggested fixes
      3. Prevention strategies
    `
  }
];
```

## Schema Validation with Zod

Use Zod for robust input validation:

```typescript
// schemas/tools.ts
import { z } from 'zod';

export const projectPathSchema = z
  .string()
  .min(1, 'Project path required')
  .refine(
    (path) => path.endsWith('.xcodeproj') || path.endsWith('.xcworkspace'),
    'Must be an Xcode project or workspace'
  );

export const buildSchema = z.object({
  projectPath: projectPathSchema,
  scheme: z.string().min(1, 'Scheme required'),
  configuration: z.enum(['Debug', 'Release', 'Beta']).default('Debug'),
  derivedDataPath: z.string().optional()
});

export type BuildInput = z.infer<typeof buildSchema>;
```

## Utility Functions

Create reusable utilities for common operations:

```typescript
// utils/exec.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function executeCommand(
  command: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string }> {
  const fullCommand = command.map(arg =>
    arg.includes(' ') ? `"${arg}"` : arg
  ).join(' ');

  try {
    const result = await execAsync(fullCommand, {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: options?.timeout ?? 60000,
      cwd: options?.cwd
    });

    return result;
  } catch (error: any) {
    throw new Error(`Command failed: ${error.message}`);
  }
}
```

## Transport Configuration

### Standard I/O (Local)

```typescript
// For local Claude Desktop integration
const transport = new StdioServerTransport();
await server.connect(transport);
```

### HTTP with SSE (Remote)

```typescript
// For remote server deployment
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const transport = new SSEServerTransport('/sse', response);
await server.connect(transport);
```

## Error Handling Strategy

Implement consistent error handling with helpful messages:

```typescript
class MCPError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

async function handleToolExecution(name: string, args: unknown) {
  try {
    const result = await executeTool(name, args);
    return {
      content: [{
        type: 'text',
        text: `✅ ${formatSuccess(result)}`
      }]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      return {
        content: [{
          type: 'text',
          text: `❌ ${error.message}`,
          metadata: { code: error.code, details: error.details }
        }]
      };
    }

    // Unexpected errors
    logger.error('Unexpected error:', error);
    return {
      content: [{
        type: 'text',
        text: '❌ An unexpected error occurred. Please check logs.'
      }]
    };
  }
}
```

## Performance Optimization

### Caching Strategy

```typescript
// utils/cache.ts
class SimpleCache<T> {
  private cache = new Map<string, { value: T; expires: number }>();

  set(key: string, value: T, ttlSeconds: number = 60) {
    this.cache.set(key, {
      value,
      expires: Date.now() + (ttlSeconds * 1000)
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }
}

// Usage in tool
const simulatorCache = new SimpleCache<SimulatorList>();

async function getSimulators() {
  const cached = simulatorCache.get('all');
  if (cached) return cached;

  const simulators = await fetchSimulators();
  simulatorCache.set('all', simulators, 30); // Cache for 30 seconds
  return simulators;
}
```

### Streaming Large Outputs

```typescript
import { Readable } from 'stream';

async function streamBuildOutput(projectPath: string) {
  const buildProcess = spawn('xcodebuild', ['-project', projectPath]);

  return {
    content: [{
      type: 'text',
      stream: Readable.from(buildProcess.stdout)
    }]
  };
}
```

## Testing Approach

### Unit Testing Tools

```typescript
// tools/__tests__/build.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { buildTool, buildToolSchema } from '../build.js';
import * as exec from '../../utils/exec.js';

jest.mock('../../utils/exec.js');

describe('Build Tool', () => {
  it('should validate input and execute build', async () => {
    const mockExec = jest.mocked(exec.executeCommand);
    mockExec.mockResolvedValue({
      stdout: 'Build Succeeded',
      stderr: ''
    });

    const input = {
      projectPath: '/path/to/project.xcodeproj',
      scheme: 'MyApp',
      configuration: 'Debug'
    };

    const validated = buildToolSchema.parse(input);
    const result = await buildTool(validated);

    expect(result.content[0].text).toContain('Build Succeeded');
    expect(mockExec).toHaveBeenCalledWith([
      'xcodebuild',
      '-project', '/path/to/project.xcodeproj',
      '-scheme', 'MyApp',
      '-configuration', 'Debug'
    ]);
  });
});
```

### Integration Testing

```typescript
// __tests__/server.integration.test.ts
import { XcodeMCPServer } from '../server.js';
import { TestTransport } from '@modelcontextprotocol/sdk/testing.js';

describe('Server Integration', () => {
  it('should handle tool requests', async () => {
    const server = new XcodeMCPServer();
    const transport = new TestTransport();
    await server.connect(transport);

    const response = await transport.request('tools/call', {
      name: 'build_xcode',
      arguments: {
        projectPath: 'test.xcodeproj',
        scheme: 'Test'
      }
    });

    expect(response).toBeDefined();
    expect(response.content).toHaveLength(1);
  });
});
```

## Security Best Practices

### Input Sanitization

```typescript
import { z } from 'zod';

// Strict validation patterns
const safePathSchema = z
  .string()
  .regex(/^[a-zA-Z0-9\-_\/\.]+$/, 'Path contains invalid characters')
  .refine(
    (path) => !path.includes('..'),
    'Path traversal not allowed'
  );

const safeSchemeSchema = z
  .string()
  .regex(/^[a-zA-Z0-9\-_]+$/, 'Scheme contains invalid characters');
```

### Command Execution Safety

```typescript
// Use array form to prevent injection
function buildCommand(args: BuildInput): string[] {
  return [
    'xcodebuild',
    '-project', args.projectPath,
    '-scheme', args.scheme,
    '-configuration', args.configuration,
    ...(args.derivedDataPath ? ['-derivedDataPath', args.derivedDataPath] : [])
  ];
}

// Never use string concatenation for commands
// BAD: `xcodebuild -project ${projectPath}`
// GOOD: ['xcodebuild', '-project', projectPath]
```

## Configuration Management

```typescript
// config/index.ts
import { z } from 'zod';

const configSchema = z.object({
  server: z.object({
    name: z.string().default('xcode-server'),
    version: z.string().default('1.0.0'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info')
  }),
  xcode: z.object({
    defaultConfiguration: z.string().default('Debug'),
    buildTimeout: z.number().default(300000), // 5 minutes
    derivedDataPath: z.string().optional()
  }),
  cache: z.object({
    ttl: z.number().default(60), // seconds
    maxSize: z.number().default(100) // entries
  })
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const env = {
    server: {
      name: process.env.MCP_SERVER_NAME,
      version: process.env.MCP_SERVER_VERSION,
      logLevel: process.env.LOG_LEVEL
    },
    xcode: {
      defaultConfiguration: process.env.XCODE_DEFAULT_CONFIG,
      buildTimeout: process.env.XCODE_BUILD_TIMEOUT ?
        parseInt(process.env.XCODE_BUILD_TIMEOUT) : undefined,
      derivedDataPath: process.env.XCODE_DERIVED_DATA_PATH
    },
    cache: {
      ttl: process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL) : undefined,
      maxSize: process.env.CACHE_MAX_SIZE ? parseInt(process.env.CACHE_MAX_SIZE) : undefined
    }
  };

  return configSchema.parse(env);
}
```

## Error Tracking and Monitoring

### Recommended Solutions (Free with Dashboard)

#### Option 1: Sentry (Recommended for Cloud)

Sentry offers a generous free tier perfect for MCP servers:
- **Free tier**: 5K errors, 10K performance units, 50 replays/month
- **Dashboard**: Comprehensive web UI with real-time error tracking
- **TypeScript Support**: First-class TypeScript integration

```typescript
// utils/error-tracking.ts
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

// Initialize only if DSN is provided (allows local dev without Sentry)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
      new ProfilingIntegration(),
    ],
    tracesSampleRate: 0.1, // 10% of transactions
    profilesSampleRate: 0.1, // 10% profiling
  });
}

// Wrap error handling
export function captureError(error: Error, context?: Record<string, any>) {
  const log = createLogger('error-tracker');

  // Always log to Pino
  log.error({ error: error.message, stack: error.stack, ...context }, 'Error captured');

  // Send to Sentry if configured
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, {
      extra: context
    });
  }
}

// Tool wrapper with error tracking
export async function trackToolExecution<T>(
  toolName: string,
  fn: () => Promise<T>
): Promise<T> {
  const transaction = Sentry.startTransaction({
    op: 'tool',
    name: toolName,
  });

  try {
    const result = await fn();
    transaction.setStatus('ok');
    return result;
  } catch (error) {
    transaction.setStatus('internal_error');
    captureError(error, { tool: toolName });
    throw error;
  } finally {
    transaction.finish();
  }
}
```

#### Option 2: GlitchTip (Self-Hosted Alternative)

For complete data ownership, GlitchTip is Sentry-compatible but simpler:

```typescript
// Same SDK as Sentry!
import * as Sentry from '@sentry/node';

// Point to your GlitchTip instance
Sentry.init({
  dsn: 'https://key@your-glitchtip.com/1',
  // Rest of config identical to Sentry
});
```

**GlitchTip Benefits**:
- **Free self-hosting**: Run on your infrastructure
- **Simple setup**: Only needs PostgreSQL, Redis, and the app
- **Sentry compatible**: Use existing Sentry SDKs
- **Docker ready**: `docker-compose up` and you're running

#### Option 3: Rollbar (Alternative Free Tier)

Rollbar offers 5,000 events/month free:

```typescript
import Rollbar from 'rollbar';

const rollbar = new Rollbar({
  accessToken: process.env.ROLLBAR_TOKEN,
  captureUncaught: true,
  captureUnhandledRejections: true,
  payload: {
    environment: process.env.NODE_ENV || 'development'
  }
});

export function captureError(error: Error, context?: any) {
  rollbar.error(error, context);
}
```

### Integration with MCP Server

```typescript
// server.ts
import { captureError, trackToolExecution } from './utils/error-tracking';

class XcodeMCPServer {
  constructor() {
    // Set up global error handlers
    process.on('uncaughtException', (error) => {
      captureError(error, { type: 'uncaughtException' });
      logger.fatal(error, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      captureError(new Error(`Unhandled rejection: ${reason}`), {
        type: 'unhandledRejection',
        promise
      });
    });
  }

  private async handleToolCall(name: string, args: any) {
    return trackToolExecution(name, async () => {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }
      return await tool.execute(args);
    });
  }
}
```

### Environment Configuration

```bash
# .env.example
# Error Tracking (choose one)
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx  # For Sentry.io
# SENTRY_DSN=https://xxx@your-glitchtip.com/1    # For GlitchTip
# ROLLBAR_TOKEN=xxx                               # For Rollbar

# Optional: Error tracking environment
NODE_ENV=production
```

### Benefits of Error Tracking

1. **Real-time Alerts**: Get notified of errors immediately
2. **Error Grouping**: Similar errors grouped automatically
3. **Release Tracking**: See which version introduced errors
4. **Performance Monitoring**: Track tool execution times
5. **User Context**: Know which operations are failing
6. **Trend Analysis**: Identify patterns in failures
7. **Stack Traces**: Full context even in production

### Privacy Considerations

When using error tracking with MCP servers:

```typescript
// Sanitize sensitive data before sending
function sanitizeContext(context: any): any {
  const sanitized = { ...context };

  // Remove sensitive paths
  if (sanitized.projectPath) {
    sanitized.projectPath = sanitized.projectPath.replace(
      /\/Users\/[^/]+/,
      '/Users/[REDACTED]'
    );
  }

  // Remove tokens, keys, etc.
  delete sanitized.apiKey;
  delete sanitized.token;

  return sanitized;
}

export function captureError(error: Error, context?: any) {
  const sanitizedContext = context ? sanitizeContext(context) : {};
  Sentry.captureException(error, { extra: sanitizedContext });
}
```

## Debugging and Development

### Critical: Logging Requirements for MCP Servers

⚠️ **WARNING**: MCP servers using STDIO transport have strict logging requirements:

1. **NEVER use `console.log()`** - It writes to stdout and corrupts the JSON-RPC protocol
2. **ALWAYS use `console.error()`** - It writes to stderr which is safe for logging
3. **Configure logging libraries for stderr** - Libraries like Pino, Winston, or Bunyan must be configured to output to stderr

```typescript
// ❌ WRONG - Breaks MCP protocol
console.log("Server started");
logger.info("Processing request"); // If logger writes to stdout

// ✅ CORRECT - Safe for MCP
console.error("Server started");
logger.info("Processing request"); // If logger writes to stderr
```

The MCP specification states:
- Servers MUST NOT write anything to stdout except valid JSON-RPC messages
- Servers MAY write UTF-8 strings to stderr for logging
- Clients capture stderr logs in their respective log directories

### Benefits of Pino with Multi-Stream Logging

1. **MCP Protocol Compliance**: Primary stream to stderr ensures protocol integrity
2. **Persistent Debugging**: File logs preserved for post-mortem analysis
3. **Build History**: Complete xcodebuild outputs saved separately for troubleshooting
4. **Performance**: Pino is one of the fastest Node.js loggers, minimal overhead
5. **Structured Logging**: JSON format makes logs searchable and parseable
6. **Rotation Ready**: Date-based filenames enable easy log rotation
7. **Debug Flexibility**: Different log levels for different streams

### Using MCP Inspector

```bash
# Install the inspector
npm install -D @modelcontextprotocol/inspector

# Run your server with the inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Open http://localhost:5173 to debug
```

### Logging Strategy

#### Critical MCP Rule: Use stderr, Never stdout

**For STDIO-based MCP servers**, logging to stdout will corrupt the JSON-RPC protocol. ALL logs must go to stderr:

```typescript
// utils/logger.ts
import pino from 'pino';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';

// Ensure log directory exists
const logDir = join(homedir(), '.mcp-xcode-server', 'logs');
await mkdir(logDir, { recursive: true });

// Configure Pino for MCP compliance
const streams = [
  // Stream 1: stderr for MCP protocol compliance (required)
  {
    level: process.env.LOG_LEVEL || 'info',
    stream: pino.destination(2) // 2 = stderr file descriptor
  },
  // Stream 2: File logging for persistent debugging
  {
    level: 'debug',
    stream: pino.destination({
      dest: join(logDir, `mcp-server-${new Date().toISOString().split('T')[0]}.log`),
      sync: false
    })
  }
];

export const logger = pino({
  level: 'debug', // Capture all levels
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'mcp-xcode-server',
    pid: process.pid
  }
}, pino.multistream(streams));

// Create module-specific loggers
export const createLogger = (module: string) => logger.child({ module });

// Special logger for build outputs (saves full xcodebuild output)
export const buildLogger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime
}, pino.destination({
  dest: join(logDir, `builds-${new Date().toISOString().split('T')[0]}.log`),
  sync: false
}));

// Usage in tools
export async function buildTool(args: BuildArgs) {
  const log = createLogger('build-tool');

  try {
    log.info({ args }, 'Starting build');

    const { stdout, stderr } = await execAsync(buildCommand);

    // Log full output to build log file
    buildLogger.info({
      project: args.projectPath,
      scheme: args.scheme,
      stdout,
      stderr,
      timestamp: new Date().toISOString()
    }, 'Build output');

    // Log summary to main log
    log.info({
      project: args.projectPath,
      success: true
    }, 'Build completed');

    return formatSuccess(stdout);
  } catch (error) {
    // Log error details
    log.error({
      error: error.message,
      project: args.projectPath
    }, 'Build failed');

    // Log full error output to build log
    buildLogger.error({
      project: args.projectPath,
      error: error.message,
      stdout: error.stdout,
      stderr: error.stderr,
      timestamp: new Date().toISOString()
    }, 'Build failure');

    return formatError(error);
  }
}
```

## Deployment Considerations

### Environment Variables

```bash
# .env.example
MCP_SERVER_NAME=xcode-server
MCP_SERVER_VERSION=1.0.0
LOG_LEVEL=info
XCODE_DEFAULT_CONFIG=Debug
XCODE_BUILD_TIMEOUT=300000
CACHE_TTL=60
```

### Package.json Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "inspect": "npx @modelcontextprotocol/inspector node dist/index.js"
  }
}
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

## Conclusion

This architecture provides a robust, maintainable foundation for TypeScript MCP servers. Focus on:

1. **Clear component separation** (tools, resources, prompts)
2. **Strong typing** with TypeScript and Zod validation
3. **Modular utilities** for reusable functionality
4. **Consistent error handling** with helpful messages
5. **Performance optimization** through caching and streaming
6. **Comprehensive testing** at unit and integration levels
7. **Security-first design** with input validation and safe execution

The architecture scales from simple single-file servers to complex multi-tool implementations while maintaining clarity and maintainability.