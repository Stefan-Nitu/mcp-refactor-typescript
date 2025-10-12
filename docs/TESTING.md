# MCP Server Testing Guide with Vitest

## Overview

This guide presents comprehensive testing strategies for TypeScript MCP (Model Context Protocol) servers using Vitest, based on official best practices and the unique requirements of the MCP architecture. Vitest is chosen for its native ESM support, TypeScript integration, and superior performance with modern JavaScript tooling.

## Vitest Configuration for MCP Servers

### Basic Setup

```typescript
// vitest.config.ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '*.config.ts',
        'dist/'
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  },
  esbuild: {
    target: 'node18'
  }
});
```

### TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "types": ["vitest/globals"],
    "typeRoots": ["./node_modules/@types", "./node_modules"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

### Test Setup File

```typescript
// test/setup.ts
import { vi } from 'vitest';

// Mock console methods to avoid cluttering test output
globalThis.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
};

// Reset all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
```

## Core Testing Principles for MCP Servers

### 0. Test Behavior, Not Implementation

**The most important principle: Tests should focus on WHAT the system does, not HOW it does it.**

```typescript
// ❌ BAD: Testing implementation details
it('should call execAsync with correct parameters', () => {
  expect(mockExecAsync).toHaveBeenCalledWith('xcrun simctl list');
});

// ✅ GOOD: Testing behavior
it('should return list of available simulators', () => {
  const response = await handler({ action: 'list' });
  expect(response.status).toBe('success');
  expect(response.data.simulators).toContainEqual({
    name: 'iPhone 15',
    state: 'Shutdown'
  });
});
```

This ensures tests remain stable when refactoring internal implementation.

### Understanding Different Types of Behavior

**Key Insight: ALL tests should validate behavior, but behavior exists at different levels:**

#### Business Behavior
Tests the actual business logic and user-facing functionality.

```typescript
// Testing: "Premium users get 20% discount"
it('applies discount for premium users', () => {
  const discount = calculateDiscount(premiumUser, items);
  expect(discount).toBe(0.20);
});
```

#### Integration Behavior
Tests that components work together correctly.

```typescript
// Testing: "Order processing calculates total correctly"
it('processes order with correct total', () => {
  const result = processOrder(order);
  expect(result.total).toBe(80); // After 20% discount
});
```

#### Contract Behavior
Tests that we correctly integrate with external systems. This looks like implementation testing but is actually testing the behavior of "correct integration".

```typescript
// Testing: "We honor database transaction requirements"
it('maintains data integrity with transactions', async () => {
  await saveOrder(order);

  // This LOOKS like implementation testing:
  expect(db.beginTransaction).toHaveBeenCalled();
  expect(db.commit).toHaveBeenCalled();

  // But it's ACTUALLY testing the behavior:
  // "We prevent data corruption by using transactions"
});

// Testing: "We follow Apple's thread-safety requirements"
it('follows AVCaptureDevice API contract', () => {
  flashlight.toggle();

  // Not testing "we called lock()", but rather:
  // "We follow Apple's required thread-safety protocol"
  expect(device.wasLockedBeforeModification).toBe(true);
});
```

### The Key Question: "What Behavior Am I Testing?"

Before writing any test, ask yourself:

1. **What user-facing behavior does this test validate?**
   - "Users see an error when no camera is available"
   - "Premium users receive their discount"
   - "Tasks appear completed when marked done"

2. **What system behavior does this test validate?**
   - "We maintain data consistency"
   - "We follow API contracts correctly"
   - "We handle errors gracefully"

3. **Would this test break if I refactored MY CODE but kept the same behavior?**
   - If YES → You're testing implementation (bad)
   - If NO → You're testing behavior (good)

   **Important:** This question is about refactoring YOUR code, not changing frameworks!
   - Refactoring your algorithm = Test should NOT break
   - Switching frameworks/libraries = Test MAY break (and that's OK!)

   Protocol compliance tests SHOULD break when you change dependencies - that's their job!

### The Testing Pyramid with Behavior Context

```
E2E Tests:         Testing "User can complete full workflow" behavior
                   (Real browser, real backend, real database)

Integration Tests: Testing "Components work together" behavior
                   (Multiple units, mocked boundaries)

Contract Tests:    Testing "We integrate correctly" behavior
                   (Framework boundaries, API contracts)

Unit Tests:        Testing "Business logic is correct" behavior
                   (Pure functions, isolated components)
```

### When Contract Testing Is Actually Behavior Testing

Contract tests that appear to test implementation are actually testing critical behaviors:

```typescript
// This test prevents production breakage:
it('uses Prisma ORM correctly', async () => {
  await userRepository.create(userData);

  // Looks like implementation testing:
  expect(prisma.user.create).toHaveBeenCalledWith({
    data: userData
  });

  // But actually validates the behavior:
  // "We maintain compatibility with our ORM"
  // Without this, someone might bypass Prisma and break production!
});
```

**Contract tests serve as safety rails:** They warn you when you're about to break a critical integration, which IS a behavior - the behavior of maintaining system compatibility.

### What Can and Cannot Be Unit Tested

#### ✅ CAN Be Unit Tested (with proper mocking)
- **Business Logic**: Calculations, validations, transformations
- **Time-based Logic**: Using Vitest's `vi.useFakeTimers()`
- **API Calls**: Mock the fetch/axios calls
- **Browser Storage**: Mock localStorage/sessionStorage
- **DOM Events**: Using Testing Library's fireEvent

```typescript
// Time-based code IS testable with Vitest!
describe('Debounced search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays search by 300ms', async () => {
    const searchFn = vi.fn();
    const debouncedSearch = debounce(searchFn, 300);

    debouncedSearch('query');
    expect(searchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(searchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(searchFn).toHaveBeenCalledWith('query');
  });
});
```

#### ⚠️ Requires Contract Testing
- **Database Operations**: Test correct use of transactions
- **External API Integration**: Test we follow their contract
- **Framework Conventions**: Test we follow required patterns

#### ❌ TRULY Cannot Be Unit Tested
- **Hardware Behavior**: LED actually turning on, sound playing
- **Network Layer**: Packets actually transmitted
- **Browser Rendering**: Actual pixels drawn on screen
- **User Perception**: What humans actually see/hear
- **Third-party Services**: External API actually working

```typescript
// Example: Notification system
class NotificationService {
  // ✅ CAN test: Our logic around timing
  scheduleNotification(delay: number) {
    setTimeout(() => this.show(), delay);
  }

  // ✅ CAN test: We call the API correctly (contract)
  show() {
    if ('Notification' in window) {
      new Notification('Hello'); // Can test we call this
    }
  }

  // ❌ CANNOT test: User actually sees the OS notification
  // This requires manual or E2E testing
}
```

### 1. Protocol Compliance Testing

MCP servers must strictly adhere to the JSON-RPC protocol. Test for:

- **Message Format**: All responses must be valid JSON-RPC 2.0
- **Error Codes**: Use standard JSON-RPC error codes (-32700 to -32603)
- **Request/Response Matching**: Verify `id` fields match between requests and responses
- **Notification Handling**: Ensure notifications don't expect responses

### 2. STDIO Transport Testing

For servers using STDIO transport, critical requirements:

```typescript
// test/stdio.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('STDIO Transport Compliance', () => {
  it('should NEVER write logs to stdout', () => {
    // Arrange
    const stdoutSpy = vi.spyOn(process.stdout, 'write');
    const server = new MCPServer();

    // Act
    server.handleRequest({ method: 'tools/list', id: 1 });

    // Assert - stdout should only contain JSON-RPC messages
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\{"jsonrpc":"2\.0"/)
    );
  });

  it('should write all logs to stderr', () => {
    // Arrange
    const stderrSpy = vi.spyOn(process.stderr, 'write');

    // Act
    logger.info('Server started');

    // Assert
    expect(stderrSpy).toHaveBeenCalled();
  });
});
```

### 3. Tool Testing Strategy

Test MCP tools as isolated functions with clear inputs and outputs:

```typescript
// tools/__tests__/build.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildTool, buildSchema } from '../build';
import { z } from 'zod';

describe('Build Tool', () => {
  describe('Schema Validation', () => {
    it('should accept valid input', () => {
      // Arrange
      const input = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug'
      };

      // Act & Assert
      expect(() => buildSchema.parse(input)).not.toThrow();
    });

    it('should reject invalid project path', () => {
      // Arrange
      const input = {
        projectPath: 'not-a-project',
        scheme: 'MyApp'
      };

      // Act & Assert
      expect(() => buildSchema.parse(input)).toThrow(z.ZodError);
    });
  });

  describe('Tool Execution', () => {
    it('should return MCP-formatted response on success', async () => {
      // Arrange
      const mockExec = vi.fn().mockResolvedValue({
        stdout: 'Build Succeeded',
        stderr: ''
      });

      const input = buildSchema.parse({
        projectPath: '/test/project.xcodeproj',
        scheme: 'Test'
      });

      // Act
      const result = await buildTool(input, mockExec);

      // Assert
      expect(result).toEqual({
        content: [{
          type: 'text',
          text: expect.stringContaining('✅ Build succeeded')
        }]
      });
    });

    it('should handle build failures gracefully', async () => {
      // Arrange
      const mockExec = vi.fn().mockRejectedValue(
        new Error('Build failed: No such module')
      );

      // Act
      const result = await buildTool(validInput, mockExec);

      // Assert
      expect(result.content[0].text).toContain('❌');
      expect(result.content[0].text).toContain('Build failed');
    });
  });
});
```

## Testing with MCP Inspector

### Interactive Testing Workflow

The MCP Inspector is the primary tool for testing MCP servers during development:

```bash
# Test your compiled TypeScript server
npx @modelcontextprotocol/inspector node dist/index.js

# Test with arguments
npx @modelcontextprotocol/inspector node dist/index.js --config ./config.json
```

### Inspector Testing Checklist

1. **Connection Testing**
   - [ ] Server starts without errors
   - [ ] Capability negotiation succeeds
   - [ ] Server info is correctly displayed

2. **Tool Testing**
   - [ ] All tools appear in the Tools tab
   - [ ] Tool schemas are correctly displayed
   - [ ] Tools execute with valid inputs
   - [ ] Tools handle invalid inputs gracefully
   - [ ] Error messages are helpful and clear

3. **Resource Testing** (if applicable)
   - [ ] Resources list correctly
   - [ ] Resource content can be retrieved
   - [ ] Subscriptions work as expected

4. **Error Handling**
   - [ ] Invalid tool calls return proper errors
   - [ ] Network failures are handled gracefully
   - [ ] Timeout scenarios work correctly

## Unit Testing Patterns

### Testing Tool Functions

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

describe('Simulator Tool', () => {
  let mockExecutor: MockedFunction<ExecuteCommand>;

  beforeEach(() => {
    mockExecutor = vi.fn();
  });

  it('should list available simulators', async () => {
    // Arrange
    const mockOutput = JSON.stringify({
      devices: {
        'iOS 17.0': [{
          udid: 'TEST-UDID',
          name: 'iPhone 15',
          state: 'Booted'
        }]
      }
    });
    mockExecutor.mockResolvedValue({ stdout: mockOutput, stderr: '' });

    // Act
    const result = await listSimulators(mockExecutor);

    // Assert
    expect(result.content[0].text).toContain('iPhone 15');
    expect(result.content[0].text).toContain('Booted');
  });
});
```

### Testing Schema Validation

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('Input Validation', () => {
  it('should validate enum values strictly', () => {
    const schema = z.object({
      configuration: z.enum(['Debug', 'Release', 'Beta'])
    });

    // Valid
    expect(() => schema.parse({ configuration: 'Debug' })).not.toThrow();

    // Invalid
    expect(() => schema.parse({ configuration: 'debug' })).toThrow();
    expect(() => schema.parse({ configuration: 'Production' })).toThrow();
  });

  it('should provide helpful error messages', () => {
    try {
      projectPathSchema.parse('invalid-path');
    } catch (error) {
      expect(error.errors[0].message).toContain('must end with .xcodeproj');
    }
  });
});
```

## Integration Testing

### Testing Server Initialization

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

describe('Server Integration', () => {
  let server: Server;
  let transport: TestTransport;

  beforeEach(() => {
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    transport = new TestTransport();
  });

  it('should handle initialization', async () => {
    // Act
    await server.connect(transport);
    const response = await transport.request('initialize', {
      protocolVersion: '1.0.0',
      capabilities: {}
    });

    // Assert
    expect(response.protocolVersion).toBe('1.0.0');
    expect(response.serverInfo.name).toBe('test-server');
  });

  it('should list available tools', async () => {
    // Arrange
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'build_xcode',
        description: 'Build an Xcode project',
        inputSchema: { type: 'object' }
      }]
    }));

    // Act
    await server.connect(transport);
    const response = await transport.request('tools/list');

    // Assert
    expect(response.tools).toHaveLength(1);
    expect(response.tools[0].name).toBe('build_xcode');
  });
});
```

## End-to-End Testing

### Testing with Claude Code

Claude Code is the IDE integration for MCP servers. Create a test configuration for Claude Code:

```json
{
  "mcpServers": {
    "xcode-server": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "LOG_LEVEL": "debug",
        "TEST_MODE": "true"
      }
    }
  }
}
```

### E2E Test Scenarios

```typescript
describe('E2E Claude Code Integration', () => {
  it('should connect to Claude Code successfully', async () => {
    // 1. Build the server
    // 2. Configure MCP settings in Claude Code
    // 3. Verify server appears in available tools
    // 4. Execute a build command through Claude Code
    // 5. Verify Xcode operations complete successfully
  });

  it('should handle file system operations in IDE context', async () => {
    // 1. Request file creation through Claude Code
    // 2. Verify approval dialog appears
    // 3. Confirm operation
    // 4. Verify file appears in project
  });
});
```

## Debugging and Troubleshooting

### Common Testing Issues

#### 1. Server Not Appearing in Inspector

```typescript
// Check for common issues
describe('Server Startup', () => {
  it('should not throw during initialization', () => {
    expect(() => new XcodeMCPServer()).not.toThrow();
  });

  it('should register all expected tools', () => {
    const server = new XcodeMCPServer();
    expect(server.getTools()).toContain('build_xcode');
    expect(server.getTools()).toContain('list_simulators');
  });
});
```

#### 2. Tool Execution Failures

```typescript
// Test error scenarios explicitly
it('should handle missing Xcode gracefully', async () => {
  mockExec.mockRejectedValue(new Error('xcodebuild: command not found'));

  const result = await buildTool(validInput);

  expect(result.content[0].text).toContain('Xcode is not installed');
});
```

### Logging for Tests

```typescript
// test/helpers/logger.ts
export class TestLogger {
  private logs: Array<{ level: string; message: string }> = [];

  log(level: string, message: string) {
    this.logs.push({ level, message });
    // Always use stderr in tests
    if (process.env.DEBUG_TESTS) {
      console.error(`[TEST ${level}] ${message}`);
    }
  }

  getLogs() {
    return this.logs;
  }

  clear() {
    this.logs = [];
  }
}
```

## Performance Testing

### Tool Response Times

```typescript
describe('Performance', () => {
  it('should respond to tool calls within 5 seconds', async () => {
    const start = Date.now();

    await simulatorTool.execute({
      action: 'list'
    });

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(5000);
  });

  it('should handle concurrent tool calls', async () => {
    const promises = Array(10).fill(null).map(() =>
      buildTool(validInput)
    );

    const results = await Promise.all(promises);

    results.forEach(result => {
      expect(result.content).toBeDefined();
    });
  });
});
```

## Security Testing

### Input Sanitization

```typescript
describe('Security', () => {
  it('should prevent command injection', async () => {
    const maliciousInput = {
      projectPath: '/test/project.xcodeproj"; rm -rf /',
      scheme: 'Test'
    };

    // Schema should reject this
    expect(() => buildSchema.parse(maliciousInput)).toThrow();
  });

  it('should validate file paths are within allowed directories', () => {
    const schema = z.string().refine(
      path => !path.includes('..'),
      'Path traversal not allowed'
    );

    expect(() => schema.parse('../../../etc/passwd')).toThrow();
  });
});
```

## Test Organization

### Test File Naming Convention

**MANDATORY: All test files must follow this strict naming convention:**

- `*.unit.test.ts` - Unit tests (pure business logic, mock ALL dependencies, NO implementation testing)
- `*.contract.test.ts` - Protocol compliance tests (verify correct API/framework usage, test integration boundaries)
- `*.integration.test.ts` - Integration tests (test multiple components together, mock only external systems)
- `*.e2e.test.ts` - End-to-end tests (full application flow, no mocks, real system interaction)

```
src/
├── task-repository.ts
├── task-repository.unit.test.ts        # Business logic only
├── task-repository.contract.test.ts    # localStorage API usage
├── task-repository.integration.test.ts # With other components
└── task-repository.e2e.test.ts         # Full persistence flow
```

#### What Goes in Each Test Type

**Unit Tests - Business Logic ONLY**
```typescript
// task-service.unit.test.ts
describe('TaskService', () => {
  it('calculates task completion percentage', () => {
    // Pure business logic - no dependencies
    const task = { completed: 3, total: 10 };
    expect(calculateProgress(task)).toBe(30);
  });

  it('validates task title length', () => {
    // Business rule - no external dependencies
    expect(isValidTitle('x'.repeat(101))).toBe(false);
  });
});
```

**Contract Tests - Framework/API Integration**
```typescript
// task-repository.contract.test.ts
describe('TaskRepository localStorage contract', () => {
  it('correctly serializes tasks to localStorage', () => {
    // Testing we use localStorage API correctly
    repository.save(task);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'tasks',
      JSON.stringify([task])
    );
  });

  it('handles localStorage quota exceeded', () => {
    // Testing we handle browser API errors correctly
    localStorage.setItem.mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => repository.save(hugeTask)).toThrow('Storage full');
  });
});
```

**Integration Tests - Component Interactions**
```typescript
// task-workflow.integration.test.ts
describe('Task completion workflow', () => {
  it('updates parent progress when child completes', async () => {
    // Testing multiple components work together
    const parent = await taskService.create({ title: 'Parent' });
    const child = await taskService.addChild(parent.id, { title: 'Child' });

    await taskService.complete(child.id);

    const updatedParent = await taskService.get(parent.id);
    expect(updatedParent.progress).toBe(50); // 1 of 2 children done
  });
});
```

**E2E Tests - Full User Flows**
```typescript
// task-management.e2e.test.ts
describe('Complete task management flow', () => {
  it('user can create, edit, complete, and delete tasks', async () => {
    // Real browser, real backend, real database
    await page.goto('/tasks');
    await page.click('[data-testid="new-task"]');
    await page.fill('input[name="title"]', 'My Task');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=My Task')).toBeVisible();

    await page.click('[data-testid="complete-task"]');
    await expect(page.locator('.completed')).toHaveText('My Task');
  });
});
```

### Recommended Test Structure

```
tests/
├── unit/                    # Fast, isolated tests
│   ├── tools/              # Tool function tests
│   ├── schemas/            # Validation tests
│   └── utils/              # Utility function tests
├── integration/            # Server integration tests
│   ├── initialization.test.ts
│   ├── tool-execution.test.ts
│   └── error-handling.test.ts
├── e2e/                    # End-to-end tests
│   └── claude-desktop.test.ts
└── fixtures/               # Test data and mocks
    ├── mock-responses.json
    └── test-projects/
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: MCP Server Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Test with MCP Inspector
        run: |
          npm run build
          npx @modelcontextprotocol/inspector node dist/index.js --test-mode
```


## Vitest TypeScript Mocking Best Practices

### 1. Modern vi.fn() Type Signatures

Vitest uses a simplified generic type system for mock functions:

```typescript
import { vi, type Mock, type MockedFunction } from 'vitest';

// ✅ GOOD - Modern Vitest approach with function type
const mockFunction = vi.fn<() => Promise<{ success: boolean }>>();
mockFunction.mockResolvedValue({ success: true });

// With parameters - pass the entire function signature
const mockExecAsync = vi.fn<(cmd: string) => Promise<{ stdout: string; stderr: string }>>();

// Multiple parameters
const mockCallback = vi.fn<(error: Error | null, data?: string) => void>();

// Using MockedFunction type for better inference
let mockExecutor: MockedFunction<(cmd: string) => Promise<string>>;
mockExecutor = vi.fn();

// ✅ BEST - Use interface method types directly
interface MyService {
  execute(cmd: string): Promise<void>;
}
const mockExecute = vi.fn<MyService['execute']>();
```

### 1.1 Solving "Cannot access before initialization" with vi.hoisted()

When mocking modules that use variables from the test scope, use `vi.hoisted()`:

```typescript
// ❌ BAD - Causes "Cannot access before initialization" error
const mockExecAsync = vi.fn();
vi.mock('util', () => ({
  promisify: () => mockExecAsync // Error: mockExecAsync not available yet
}));

// ✅ GOOD - Using vi.hoisted() to define variables
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn<(cmd: string) => Promise<{ stdout: string; stderr: string }>>()
}));

vi.mock('util', () => ({
  promisify: () => mockExecAsync // Now mockExecAsync is available
}));

// ✅ ALTERNATIVE - Use "mock" prefix (Vitest doesn't hoist these)
const mockExecAsync = vi.fn(); // Note: "mock" prefix
vi.mock('util', () => ({
  promisify: () => mockExecAsync
}));

// ✅ ALTERNATIVE - Use vi.doMock() for non-hoisted mocking
const mockExecAsync = vi.fn();
vi.doMock('util', () => ({
  promisify: () => mockExecAsync
}));
// Note: Must import the module AFTER vi.doMock()
```

### 2. Mocking ESM Modules with vi.mock()

For ESM modules, use async factory functions with proper typing:

```typescript
import type * as NavigationModule from './navigation';

// Mock ESM module with type safety
vi.mock('./navigation', async () => {
  const actual = await vi.importActual<typeof NavigationModule>('./navigation');
  return {
    ...actual,
    navigate: vi.fn(),
  };
});

// For Node.js built-in modules
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Access mocked functions with vi.mocked()
import { navigate } from './navigation';
const mockedNavigate = vi.mocked(navigate);
mockedNavigate.mockResolvedValue({ success: true });
```

### 3. Match Async vs Sync Return Types

```typescript
// Synchronous mock
const mockSync = vi.fn<() => string>();
mockSync.mockReturnValue('result');

// Asynchronous mock - use mockResolvedValue
const mockAsync = vi.fn<() => Promise<string>>();
mockAsync.mockResolvedValue('result');

// Chain multiple async responses
mockAsync
  .mockResolvedValueOnce('first')
  .mockRejectedValueOnce(new Error('error'))
  .mockResolvedValue('default');
```

### 4. Factory Pattern with Vitest (Recommended for Type Safety)

```typescript
import { vi } from 'vitest';

// ✅ BEST - Type-safe factory patterns without type assertions
function createMockService(): MyService {
  return {
    execute: vi.fn<MyService['execute']>(),
    query: vi.fn<MyService['query']>(),
    status: 'ready' // Non-function properties
  };
}

// With partial mocking using satisfies
function createPartialMock() {
  return {
    execute: vi.fn(),
    query: vi.fn()
  } satisfies Partial<MyService>;
}

// Factory with overrides pattern
function createMockChildProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const emitter = new EventEmitter();

  return Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: null,
    pid: 123,
    kill: vi.fn().mockReturnValue(true),
    ...overrides
  }) as ChildProcess;
}

// Context-based testing pattern
function createTestContext() {
  const mockExecute = vi.fn<(cmd: string) => Promise<{ stdout: string }>>();
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
  };

  return {
    mocks: { mockExecute, mockLogger },
    sut: new MyService({ execute: mockExecute, logger: mockLogger }),
  };
}

// Usage with beforeEach
describe('MyService', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it('should execute command', async () => {
    ctx.mocks.mockExecute.mockResolvedValue({ stdout: 'success' });

    const result = await ctx.sut.run();
    expect(result).toBe('success');
  });
});
```

### 5. Using vi.mocked() for Type Safety

```typescript
import { readFile } from 'fs/promises';
import { vi } from 'vitest';

vi.mock('fs/promises');

// vi.mocked provides proper type inference
const mockedReadFile = vi.mocked(readFile);
mockedReadFile.mockResolvedValue(Buffer.from('content'));

// Works with deep mocking
vi.mocked(console.log).mockImplementation(() => {});
```

### 6. Handling Partial Mocks and Spies

```typescript
import { vi } from 'vitest';

// Spy on existing object methods
const spy = vi.spyOn(console, 'log');

// Partial mock of a module
vi.mock('./utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils')>();
  return {
    ...actual,
    heavyFunction: vi.fn().mockReturnValue('mocked'),
  };
});

// Mock specific class methods
class Service {
  async fetch(id: string) { /* ... */ }
}

const service = new Service();
vi.spyOn(service, 'fetch').mockResolvedValue({ id: '1', name: 'Test' });
```

### 7. Concurrent and Parallel Testing

```typescript
import { describe, it, expect } from 'vitest';

// Run all tests in this suite concurrently
describe.concurrent('Parallel API tests', () => {
  it('fetches user data', async () => {
    // This test runs in parallel with others
  });

  it('fetches post data', async () => {
    // Runs concurrently with the test above
  });

  // Mark specific test as sequential within concurrent suite
  it.sequential('updates database', async () => {
    // This runs after parallel tests complete
  });
});

// Configure concurrency in vitest.config.ts
export default defineConfig({
  test: {
    maxConcurrency: 5,
    sequence: {
      concurrent: true, // Run all tests concurrently by default
    },
  },
});
```

### 8. Vitest-Specific Features for MCP Testing

```typescript
import { vi, expect, beforeAll, afterEach } from 'vitest';

// Fake timers for timeout testing
beforeAll(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// Test with controlled time
it('should timeout after 5 seconds', async () => {
  const promise = mcpServer.callTool('long-running');

  // Fast-forward time
  await vi.advanceTimersByTimeAsync(5000);

  await expect(promise).rejects.toThrow('Timeout');
});

// Snapshot testing for MCP responses
it('should return correct tool response format', async () => {
  const response = await mcpServer.callTool('refactor', {
    type: 'rename',
    oldName: 'foo',
    newName: 'bar'
  });

  expect(response).toMatchSnapshot();
});

// In-source testing (colocate tests with implementation)
// Useful for small utility functions
export function validatePath(path: string): boolean {
  return path.endsWith('.ts') || path.endsWith('.js');
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe('validatePath', () => {
    it('accepts TypeScript files', () => {
      expect(validatePath('test.ts')).toBe(true);
    });
  });
}
```

## Avoiding Type Assertions in Tests

### ❌ AVOID: Type Assertions with "as unknown as"

```typescript
// BAD - Loses type safety and hides potential issues
const mockService = {
  execute: vi.fn()
} as unknown as MyService;

// BAD - Multiple assertions are a code smell
const mock = someObject as unknown as SomeType as AnotherType;
```

### ✅ PREFER: Type-Safe Alternatives

```typescript
// GOOD - Use factory functions
function createMockService(): MyService {
  return {
    execute: vi.fn<MyService['execute']>(),
    query: vi.fn<MyService['query']>(),
    // ... implement all required properties
  };
}

// GOOD - Use satisfies for partial mocks
const partialMock = {
  execute: vi.fn(),
  query: vi.fn()
} satisfies Partial<MyService>;

// GOOD - Use vi.mocked() for module mocks
import { service } from './service';
vi.mock('./service');
const mockedService = vi.mocked(service);
```

### When Type Assertions Are Acceptable

```typescript
// ACCEPTABLE - For complex EventEmitter merging patterns
function createMockProcess(): ChildProcess {
  const emitter = new EventEmitter();
  // Complex object merging that TypeScript can't infer
  return Object.assign(emitter, {
    stdin: new PassThrough(),
    // ... other properties
  }) as ChildProcess;  // Single assertion at the end
}

// ACCEPTABLE - When testing error cases
const invalidInput = { foo: 'bar' } as ValidInput; // Testing schema validation
```

## Best Practices Summary

1. **Always test stderr vs stdout compliance** - Critical for STDIO transport
2. **Use explicit type signatures for vi.fn()** - Ensures TypeScript type safety
3. **Mock ESM modules with async factories** - Use vi.importActual for partial mocks
4. **Leverage vi.mocked() for type inference** - Better than type assertions
5. **Test schemas separately from logic** - Ensures validation works correctly
6. **Test error paths explicitly** - Users need clear error messages
7. **Validate MCP response format** - Must match protocol specification
8. **Use describe.concurrent for parallel tests** - Faster test execution
9. **Create test context factories** - Better than scattered setup code
10. **Use vi.spyOn for partial mocking** - Maintains original functionality
11. **Avoid type assertions** - Use factory patterns and satisfies operator instead
12. **Use interface index types** - `vi.fn<Interface['method']>()` for perfect type matching

## Troubleshooting Test Failures

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Logs appearing in test output | Writing to stdout | Use `console.error` or configure logger for stderr |
| Tool not found in Inspector | Registration error | Check tool name and schema definition |
| Schema validation too strict | Over-specific regex | Use simpler patterns, validate in tool logic |
| Async tests timing out | Missing await | Ensure all async operations are awaited |
| Flaky integration tests | Race conditions | Use proper test setup/teardown, avoid shared state |

## Conclusion

Testing MCP servers requires attention to protocol compliance, proper STDIO handling, and comprehensive coverage of tools and error scenarios. Use the MCP Inspector as your primary development tool, complement with automated tests, and always ensure logs go to stderr, never stdout.