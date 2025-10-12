/**
 * Grouped MCP tools with optimized descriptions
 * v2.0 - Replaces 14 individual tools with 4 grouped tools
 */

import { z } from 'zod';
import { OperationName, OperationRegistry } from '../operations/registry.js';
import { Telemetry } from '../utils/telemetry.js';
import { RefactorResult } from '../language-servers/typescript/tsserver-client.js';

export interface GroupedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
  };
  operations: string[];
  execute: (args: Record<string, unknown>, registry: OperationRegistry) => Promise<RefactorResult>;
}

// File Operations Tool
export const fileOperationsTool: GroupedTool = {
  name: 'file_operations',
  title: 'File Operations',
  description: `File operations with automatic import/export updates.

vs Edit: Updates ALL imports across project. vs Bash: TypeScript-aware, prevents breaking references.

Use when: Renaming/moving files, reorganizing code structure.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false
  },
  operations: ['rename_file', 'move_file', 'batch_move_files'],
  inputSchema: z.object({
    operation: z.enum(['rename_file', 'move_file', 'batch_move_files']),
    sourcePath: z.string().optional(),
    newName: z.string().optional(),
    destinationPath: z.string().optional(),
    files: z.array(z.string()).optional(),
    targetFolder: z.string().optional(),
    preview: z.boolean().optional()
  }),
  async execute(args, registry) {
    const telemetry = new Telemetry();
    telemetry.start();
    telemetry.logToolCall('file_operations', args.operation as string | undefined);

    try {
      const operation = registry.getOperation(args.operation as OperationName);
      if (!operation) {
        throw new Error(`Operation not found: ${args.operation as string}`);
      }

      const result = await operation.execute(args);

      telemetry.logSuccess('file_operations', args.operation as string | undefined, result.filesChanged?.length || 0);
      return result;
    } catch (error) {
      telemetry.logError('file_operations', args.operation as string | undefined, error as Error);
      throw error;
    }
  }
};

// Code Quality Tool
export const codeQualityTool: GroupedTool = {
  name: 'code_quality',
  title: 'Code Quality',
  description: `Clean and fix code quality issues automatically.

vs Manual: Finds issues compiler detects but you might miss.

Use when: Before commits, after refactoring, or cleanup tasks.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false
  },
  operations: ['organize_imports', 'fix_all', 'remove_unused'],
  inputSchema: z.object({
    operation: z.enum(['organize_imports', 'fix_all', 'remove_unused']),
    filePath: z.string(),
    preview: z.boolean().optional()
  }),
  async execute(args, registry) {
    const telemetry = new Telemetry();
    telemetry.start();
    telemetry.logToolCall('code_quality', args.operation as string | undefined);

    try {
      const operation = registry.getOperation(args.operation as OperationName);
      if (!operation) {
        throw new Error(`Operation not found: ${args.operation as string}`);
      }

      const result = await operation.execute(args);

      telemetry.logSuccess('code_quality', args.operation as string | undefined, result.filesChanged?.length || 0);
      return result;
    } catch (error) {
      telemetry.logError('code_quality', args.operation as string | undefined, error as Error);
      throw error;
    }
  }
};

// Refactoring Tool
export const refactoringTool: GroupedTool = {
  name: 'refactoring',
  title: 'Refactoring',
  description: `Extract code to functions/constants with auto-detected types and parameters.

vs Manual: Analyzes closures, mutations, control flow - impossible to do correctly by hand.

Use when: Renaming symbols, reducing duplication, improving structure, extracting reusable logic.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false
  },
  operations: ['rename', 'extract_function', 'extract_constant', 'extract_variable', 'infer_return_type'],
  inputSchema: z.object({
    operation: z.enum(['rename', 'extract_function', 'extract_constant', 'extract_variable', 'infer_return_type']),
    filePath: z.string(),
    line: z.number(),
    text: z.string(),
    newName: z.string().optional(),
    functionName: z.string().optional(),
    constantName: z.string().optional(),
    variableName: z.string().optional(),
    preview: z.boolean().optional()
  }),
  async execute(args, registry) {
    const telemetry = new Telemetry();
    telemetry.start();
    telemetry.logToolCall('refactoring', args.operation as string | undefined);

    try {
      const operation = registry.getOperation(args.operation as OperationName);
      if (!operation) {
        throw new Error(`Operation not found: ${args.operation as string}`);
      }

      const result = await operation.execute(args);

      telemetry.logSuccess('refactoring', args.operation as string | undefined, result.filesChanged?.length || 0);
      return result;
    } catch (error) {
      telemetry.logError('refactoring', args.operation as string | undefined, error as Error);
      throw error;
    }
  }
};

// Workspace Tool
export const workspaceTool: GroupedTool = {
  name: 'workspace',
  title: 'Workspace',
  description: `Project-wide operations: search, analyze, cleanup, restart services.

vs grep: Finds dynamic imports, JSDoc refs, type-only imports text search misses.

Use when: Understanding code impact, large-scale refactoring, fixing TypeScript issues.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true // cleanup_codebase can delete files
  },
  operations: ['find_references', 'refactor_module', 'cleanup_codebase', 'restart_tsserver'],
  inputSchema: z.object({
    operation: z.enum(['find_references', 'refactor_module', 'cleanup_codebase', 'restart_tsserver']),
    filePath: z.string().optional(),
    line: z.number().optional(),
    text: z.string().optional(),
    sourcePath: z.string().optional(),
    destinationPath: z.string().optional(),
    directory: z.string().optional(),
    deleteUnusedFiles: z.boolean().optional(),
    entrypoints: z.array(z.string()).optional(),
    preview: z.boolean().optional()
  }),
  async execute(args, registry) {
    const telemetry = new Telemetry();
    telemetry.start();
    telemetry.logToolCall('workspace', args.operation as string | undefined);

    try {
      const operation = registry.getOperation(args.operation as OperationName);
      if (!operation) {
        throw new Error(`Operation not found: ${args.operation as string}`);
      }

      const result = await operation.execute(args);

      telemetry.logSuccess('workspace', args.operation as string | undefined, result.filesChanged?.length || 0);
      return result;
    } catch (error) {
      telemetry.logError('workspace', args.operation as string | undefined, error as Error);
      throw error;
    }
  }
};

export const groupedTools: GroupedTool[] = [
  fileOperationsTool,
  codeQualityTool,
  refactoringTool,
  workspaceTool
];
