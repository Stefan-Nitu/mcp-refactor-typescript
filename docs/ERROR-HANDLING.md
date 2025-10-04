# Error Handling and Presentation Patterns for MCP Servers

## Overview

This document describes error handling patterns for MCP (Model Context Protocol) servers, covering domain errors, JSON-RPC compliance, user presentation, and error tracking integration.

## MCP Protocol Requirements

### JSON-RPC Error Format

MCP servers must return errors in JSON-RPC 2.0 format:

```typescript
interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

// Standard error codes
const ErrorCodes = {
  // JSON-RPC defined errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Application errors (MCP specific)
  TOOL_NOT_FOUND: -32001,
  RESOURCE_NOT_FOUND: -32002,
  PERMISSION_DENIED: -32003,
  OPERATION_FAILED: -32004
} as const;
```

### MCP Tool Response Format

Tools return success results with content, not error codes:

```typescript
// CORRECT: Tool returns user-friendly error in content
async function buildTool(args: any): Promise<MCPResponse> {
  try {
    const result = await executeBuild(args);
    return {
      content: [{
        type: 'text',
        text: `Build succeeded: ${result.appName}`
      }]
    };
  } catch (error) {
    // Return error as content, not JSON-RPC error
    return {
      content: [{
        type: 'text',
        text: `Build failed: ${error.message}`
      }]
    };
  }
}

// WRONG: Don't throw JSON-RPC errors from tools
async function buildTool(args: any) {
  throw new JSONRPCError(-32004, 'Build failed'); // Don't do this!
}
```

## Core Architecture

### 1. Layer Responsibilities

```typescript
// Domain Layer: Pure error types with data
export class SimulatorNotFoundError extends Error {
  constructor(public readonly deviceId: string) {
    super(`Simulator not found: ${deviceId}`);
    this.name = 'SimulatorNotFoundError';
  }
}

// Application Layer: Returns domain errors
export class BootSimulatorUseCase {
  async execute(deviceId: string): Promise<Result<void>> {
    const simulator = await this.repo.findById(deviceId);
    if (!simulator) {
      return Result.failed(new SimulatorNotFoundError(deviceId));
    }
    // ... boot logic
  }
}

// Presentation Layer: Formats for users
export class BootSimulatorController {
  async execute(args: unknown): Promise<MCPResponse> {
    const result = await this.useCase.execute(args.deviceId);

    if (result.isFailure) {
      const formatted = this.formatError(result.error);
      return {
        content: [{
          type: 'text',
          text: formatted
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: 'Simulator booted successfully'
      }]
    };
  }

  private formatError(error: Error): string {
    if (error instanceof SimulatorNotFoundError) {
      return `Simulator not found: ${error.deviceId}`;
    }
    return `${error.message}`;
  }
}
```

### 2. Error Tracking Integration

Integrate with Sentry/GlitchTip/Rollbar for production monitoring:

```typescript
import { captureError } from './utils/error-tracking';

export class MCPToolController {
  async execute(args: unknown): Promise<MCPResponse> {
    try {
      const result = await this.useCase.execute(args);

      if (result.isFailure) {
        // Log to error tracking (non-blocking)
        captureError(result.error, {
          tool: this.toolName,
          args: this.sanitizeArgs(args)
        });

        return this.formatErrorResponse(result.error);
      }

      return this.formatSuccessResponse(result.value);
    } catch (unexpectedError) {
      // Capture unexpected errors with full context
      captureError(unexpectedError, {
        tool: this.toolName,
        args: this.sanitizeArgs(args),
        type: 'unexpected'
      });

      return {
        content: [{
          type: 'text',
          text: 'An unexpected error occurred. Please try again.'
        }]
      };
    }
  }

  private sanitizeArgs(args: any): any {
    // Remove sensitive data before logging
    const sanitized = { ...args };
    delete sanitized.apiKey;
    delete sanitized.password;

    // Redact user paths
    if (sanitized.projectPath) {
      sanitized.projectPath = sanitized.projectPath.replace(
        /\/Users\/[^/]+/,
        '/Users/[REDACTED]'
      );
    }

    return sanitized;
  }
}
```

## Error Categories and Handling

### 1. Validation Errors

Input validation should happen early with clear messages:

```typescript
import { z } from 'zod';

const buildSchema = z.object({
  projectPath: z.string()
    .min(1, 'Project path is required')
    .endsWith('.xcodeproj', 'Must be an Xcode project'),
  scheme: z.string().min(1, 'Scheme is required'),
  configuration: z.enum(['Debug', 'Release', 'Beta'])
});

async function validateAndBuild(args: unknown) {
  try {
    const validated = buildSchema.parse(args);
    return await executeBuild(validated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `  • ${e.path}: ${e.message}`).join('\n');
      return {
        content: [{
          type: 'text',
          text: `Invalid input:\n${issues}`
        }]
      };
    }
    throw error;
  }
}
```

### 2. External Command Failures

Handle shell command errors with helpful context:

```typescript
export class CommandExecutionError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdout: string
  ) {
    super(`Command failed with exit code ${exitCode}`);
    this.name = 'CommandExecutionError';
  }
}

// Format for users
function formatCommandError(error: CommandExecutionError): string {
  // Extract relevant error from stderr/stdout
  const errorMessage = extractErrorMessage(error.stderr || error.stdout);

  return `Build failed: ${errorMessage}

Full output:
${error.stderr || error.stdout}`;
}

function extractErrorMessage(output: string): string {
  // Look for common patterns
  const patterns = [
    /error: (.+)/i,
    /fatal: (.+)/i,
    /failed: (.+)/i
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1];
  }

  // Return first line if no pattern matches
  return output.split('\n')[0] || 'Unknown error';
}
```

### 3. State Conflicts

Handle resource state issues gracefully:

```typescript
export class SimulatorStateError extends Error {
  constructor(
    public readonly deviceId: string,
    public readonly currentState: string,
    public readonly requiredState: string
  ) {
    super(`Simulator ${deviceId} is ${currentState}, needs to be ${requiredState}`);
    this.name = 'SimulatorStateError';
  }
}

// User-friendly formatting
function formatStateError(error: SimulatorStateError): string {
  const suggestions: Record<string, string> = {
    'Booted': 'The simulator is already running',
    'Shutdown': 'Please boot the simulator first',
    'Creating': 'Please wait for simulator creation to complete'
  };

  const suggestion = suggestions[error.currentState] || '';

  return `Cannot perform operation: Simulator is ${error.currentState}
${suggestion ? `${suggestion}` : ''}`;
}
```

### 4. Network and Timeout Errors

Handle async operation failures:

```typescript
export class OperationTimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number
  ) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'OperationTimeoutError';
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new OperationTimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      captureError(error, { operation, timeoutMs });
      throw error;
    }
    throw error;
  }
}
```

## JSON Response Format

All MCP tools should return structured JSON responses for programmatic parsing:

```typescript
interface ToolResponse {
  tool: string;
  status: 'success' | 'error';
  message: string;
  data?: {
    filesChanged?: string[];
    changes?: Array<{
      file: string;
      path: string;
      edits: Array<{
        line: number;
        column?: number;
        old: string;
        new: string;
      }>;
    }>;
  };
  preview?: {
    filesAffected: number;
    estimatedTime: string;
    command: string;
  };
  nextActions?: string[];
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

// Usage - wrap JSON in text content
return {
  content: [{
    type: 'text',
    text: JSON.stringify({
      tool: 'rename',
      status: 'success',
      message: 'Renamed to "newName"',
      data: {
        filesChanged: ['file1.ts', 'file2.ts'],
        changes: [...]
      }
    }, null, 2)
  }]
};
```

## Error Recovery and Suggestions

Provide actionable suggestions when possible:

```typescript
interface ErrorWithSuggestion {
  message: string;
  suggestion?: string;
  action?: {
    tool: string;
    args: any;
  };
}

function formatErrorResponse(error: Error): ToolResponse {
  const suggestions = getSuggestions(error);

  return {
    tool: 'operation_name',
    status: 'error',
    message: error.message,
    nextActions: suggestions.action ? [
      `${suggestions.action.tool} - ${suggestions.suggestion || 'Try this tool'}`
    ] : undefined
  };
}

function getSuggestions(error: Error): ErrorWithSuggestion {
  if (error instanceof SimulatorNotFoundError) {
    return {
      message: error.message,
      suggestion: 'List available simulators with list_simulators tool',
      action: {
        tool: 'list_simulators',
        args: {}
      }
    };
  }

  if (error.message.includes('scheme')) {
    return {
      message: error.message,
      suggestion: 'List available schemes with list_schemes tool',
      action: {
        tool: 'list_schemes',
        args: { projectPath: '...' }
      }
    };
  }

  return { message: error.message };
}
```

## Logging Strategy

### Development vs Production

```typescript
import { logger, buildLogger } from './utils/logger';

export class ErrorHandler {
  static handle(error: Error, context: any) {
    // Always log locally
    logger.error({
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context
    }, 'Error occurred');

    // Save detailed logs for builds/tests
    if (context.tool === 'build_xcode') {
      buildLogger.error({
        ...context,
        error: error.message,
        fullOutput: error.stdout
      }, 'Build failure details');
    }

    // Send to error tracking in production
    if (process.env.NODE_ENV === 'production') {
      captureError(error, context);
    }
  }
}
```

## Testing Error Handling

### Unit Tests

```typescript
describe('Error Formatting', () => {
  it('should format validation errors clearly', () => {
    const error = new z.ZodError([
      {
        path: ['projectPath'],
        message: 'Required',
        code: 'invalid_type'
      }
    ]);

    const formatted = formatValidationError(error);
    const response = JSON.parse(formatted);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Invalid input');
    expect(response.errors).toContainEqual({
      path: 'projectPath',
      message: 'Required'
    });
  });

  it('should suggest actions for known errors', () => {
    const error = new SimulatorNotFoundError('iPhone-15');
    const formatted = formatErrorResponse(error);

    expect(formatted.status).toBe('error');
    expect(formatted.nextActions).toContain('list_simulators');
  });
});
```

### Integration Tests

```typescript
describe('MCP Error Responses', () => {
  it('should return JSON error in content', async () => {
    const response = await buildTool({
      projectPath: 'invalid.xcodeproj',
      scheme: 'NonExistent'
    });

    expect(response.content[0].type).toBe('text');
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.status).toBe('error');
    expect(parsed.message).toContain('Build failed');
  });

  it('should not throw JSON-RPC errors from tools', async () => {
    // Tools should always return MCPResponse with JSON content, never throw
    const response = await simulatorTool({ action: 'invalid' });

    expect(response).toHaveProperty('content');
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.status).toBe('error');
  });
});
```

## Best Practices Summary

1. **Layer Separation**: Domain errors contain data, presentation formats messages
2. **MCP Compliance**: Return errors in content, not JSON-RPC errors
3. **JSON Format**: Always return structured JSON responses for programmatic parsing
4. **User-Friendly**: Use clear language without emojis for better cross-platform compatibility
5. **Actionable**: Provide suggestions and next steps via nextActions array
6. **Track Everything**: Log locally and to error tracking service
7. **Privacy First**: Sanitize sensitive data before logging
8. **Test Coverage**: Test both error formatting and behavior
9. **Graceful Degradation**: Always return something useful to the user

## Common Pitfalls to Avoid

1. **Don't throw from tools**: Always return MCPResponse with error in content
2. **Don't log to stdout**: Use stderr via console.error or logger
3. **Don't expose internals**: Sanitize stack traces and paths
4. **Don't ignore errors**: Track everything for debugging
5. **Don't format in domain**: Keep business logic pure
6. **Don't lose context**: Include relevant data in error tracking