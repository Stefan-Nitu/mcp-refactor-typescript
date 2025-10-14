/**
 * Grouped MCP tools with optimized descriptions
 * v2.0 - Replaces 14 individual tools with 4 grouped tools
 */

import { z } from 'zod';
import { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { OperationName } from '../operation-name.js';
import { OperationRegistry } from '../registry.js';
import { Telemetry } from '../utils/telemetry.js';

export interface GroupedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape> | z.ZodEffects<z.ZodObject<z.ZodRawShape>>;
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
  description: `Rename/move TypeScript files - auto-updates ALL imports (<1s, 47 refs across 12 files).

vs Edit/Bash: They break imports. This catches dynamic imports, mocks, re-exports.

Use when: Renaming/moving TS/JS files. Always use this, not mv/Edit.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false
  },
  operations: [OperationName.RENAME_FILE, OperationName.MOVE_FILE, OperationName.BATCH_MOVE_FILES],
  inputSchema: z.object({
    operation: z.enum([OperationName.RENAME_FILE, OperationName.MOVE_FILE, OperationName.BATCH_MOVE_FILES]),
    sourcePath: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    destinationPath: z.string().min(1).optional(),
    files: z.array(z.string().min(1)).optional(),
    targetFolder: z.string().min(1).optional(),
    preview: z.boolean().optional()
  }).refine(data => {
    if (data.operation === OperationName.RENAME_FILE) {
      return !!data.sourcePath && !!data.name;
    }
    if (data.operation === OperationName.MOVE_FILE) {
      return !!data.sourcePath && !!data.destinationPath;
    }
    if (data.operation === OperationName.BATCH_MOVE_FILES) {
      return !!data.files && !!data.targetFolder;
    }
    return true;
  }, (data) => {
    if (data.operation === OperationName.RENAME_FILE) {
      if (!data.sourcePath) return { message: `sourcePath is required for ${OperationName.RENAME_FILE}` };
      if (!data.name) return { message: `name is required for ${OperationName.RENAME_FILE}` };
    }
    if (data.operation === OperationName.MOVE_FILE) {
      if (!data.sourcePath) return { message: `sourcePath is required for ${OperationName.MOVE_FILE}` };
      if (!data.destinationPath) return { message: `destinationPath is required for ${OperationName.MOVE_FILE}` };
    }
    if (data.operation === OperationName.BATCH_MOVE_FILES) {
      if (!data.files) return { message: `files is required for ${OperationName.BATCH_MOVE_FILES}` };
      if (!data.targetFolder) return { message: `targetFolder is required for ${OperationName.BATCH_MOVE_FILES}` };
    }
    return { message: 'Invalid file operation parameters' };
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
  description: `Fix ALL TypeScript errors + organize imports + remove unused (<1s, 20+ issues).

vs Manual: Compiler-verified, preserves side-effects, finds hidden issues.

Use when: After refactoring or before commits. Use proactively.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false
  },
  operations: [OperationName.ORGANIZE_IMPORTS, OperationName.FIX_ALL, OperationName.REMOVE_UNUSED],
  inputSchema: z.object({
    operation: z.enum([OperationName.ORGANIZE_IMPORTS, OperationName.FIX_ALL, OperationName.REMOVE_UNUSED]),
    filePath: z.string().min(1, 'File path cannot be empty'),
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
  description: `Rename symbols project-wide OR extract functions (auto-detects params/types/closures).

vs Edit: Updates ALL refs (imports, JSDoc, dynamic imports). Impossible by hand.

Use when: Renaming variables/functions OR extracting code. Always use this.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false
  },
  operations: [OperationName.RENAME, OperationName.EXTRACT_FUNCTION, OperationName.EXTRACT_CONSTANT, OperationName.EXTRACT_VARIABLE, OperationName.INFER_RETURN_TYPE],
  inputSchema: z.object({
    operation: z.enum([OperationName.RENAME, OperationName.EXTRACT_FUNCTION, OperationName.EXTRACT_CONSTANT, OperationName.EXTRACT_VARIABLE, OperationName.INFER_RETURN_TYPE]),
    filePath: z.string().min(1, 'File path cannot be empty'),
    line: z.number().int().positive('Line must be a positive integer'),
    text: z.string().min(1, 'Text cannot be empty'),
    name: z.string().optional(),
    preview: z.boolean().optional()
  }).refine(data => {
    if (data.operation === OperationName.RENAME) return !!data.name;
    return true;
  }, {
    message: `name is required for ${OperationName.RENAME} operation`
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
  description: `Find references (type-aware) | Cleanup | Move+organize+fix | Restart tsserver.

vs grep: Finds dynamic imports, JSDoc, type-only imports grep misses. ⚠️ Can DELETE.

Use when: Before renaming/refactoring. Use find_references first to see impact.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true // cleanup_codebase can delete files
  },
  operations: [OperationName.FIND_REFERENCES, OperationName.REFACTOR_MODULE, OperationName.CLEANUP_CODEBASE, OperationName.RESTART_TSSERVER],
  inputSchema: z.object({
    operation: z.enum([OperationName.FIND_REFERENCES, OperationName.REFACTOR_MODULE, OperationName.CLEANUP_CODEBASE, OperationName.RESTART_TSSERVER]),
    filePath: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    text: z.string().min(1).optional(),
    sourcePath: z.string().min(1).optional(),
    destinationPath: z.string().min(1).optional(),
    directory: z.string().min(1).optional(),
    deleteUnusedFiles: z.boolean().optional(),
    entrypoints: z.array(z.string()).optional(),
    preview: z.boolean().optional()
  }).refine(data => {
    if (data.operation === OperationName.FIND_REFERENCES) {
      return !!data.filePath && data.line !== undefined && !!data.text;
    }
    if (data.operation === OperationName.REFACTOR_MODULE) {
      return !!data.sourcePath && !!data.destinationPath;
    }
    if (data.operation === OperationName.CLEANUP_CODEBASE) {
      if (!data.directory) return false;
      if (data.deleteUnusedFiles && !data.entrypoints) return false;
    }
    return true;
  }, (data) => {
    if (data.operation === OperationName.FIND_REFERENCES) {
      if (!data.filePath) return { message: `filePath is required for ${OperationName.FIND_REFERENCES}` };
      if (data.line === undefined) return { message: `line is required for ${OperationName.FIND_REFERENCES}` };
      if (!data.text) return { message: `text is required for ${OperationName.FIND_REFERENCES}` };
    }
    if (data.operation === OperationName.REFACTOR_MODULE) {
      if (!data.sourcePath) return { message: `sourcePath is required for ${OperationName.REFACTOR_MODULE}` };
      if (!data.destinationPath) return { message: `destinationPath is required for ${OperationName.REFACTOR_MODULE}` };
    }
    if (data.operation === OperationName.CLEANUP_CODEBASE) {
      if (!data.directory) return { message: `directory is required for ${OperationName.CLEANUP_CODEBASE}` };
      if (data.deleteUnusedFiles && !data.entrypoints) return { message: `entrypoints is required when deleteUnusedFiles: true to prevent accidental deletion. Specify your app's entry points like ["src/main\\\\.ts$"] or use defaults at your own risk.` };
    }
    return { message: 'Invalid workspace operation parameters' };
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
