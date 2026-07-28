/**
 * Grouped MCP tools with optimized descriptions
 * v2.0 - Replaces 14 individual tools with 4 grouped tools
 */

import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { OperationName } from '../operation-name.js';
import type { OperationRegistry } from '../registry.js';
import { Telemetry } from '../utils/telemetry.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { ToolInputSchema } from './tool-input-shape.js';

interface GroupedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
  };
  operations: string[];
  execute: (
    args: Record<string, unknown>,
    registry: OperationRegistry,
  ) => Promise<RefactorResult>;
}

/**
 * MCP registration only carries the schema's raw shape, so cross-field rules
 * declared with `.refine()` never run at the protocol boundary. Applying the
 * whole schema here is what turns "which parameter?" into an answer.
 */
async function runOperation(
  tool: GroupedTool,
  args: Record<string, unknown>,
  registry: OperationRegistry,
): Promise<RefactorResult> {
  const operationName = args.operation as string | undefined;
  const telemetry = new Telemetry();
  telemetry.start();
  telemetry.logToolCall(tool.name, operationName);

  try {
    // Before the registry lookup, so an out-of-enum operation is explained
    // rather than thrown as "Operation not found: undefined"
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      telemetry.logError(tool.name, operationName, parsed.error);
      return formatValidationError(parsed.error);
    }

    const operation = registry.getOperation(args.operation as OperationName);
    if (!operation) {
      throw new Error(`Operation not found: ${args.operation as string}`);
    }

    // Raw args, not parsed.data: every operation re-parses with its own schema,
    // so this pass is validation only and must not strip fields from it
    const result = await operation.execute(args);

    telemetry.logSuccess(
      tool.name,
      operationName,
      result.filesChanged?.length || 0,
    );
    return result;
  } catch (error) {
    telemetry.logError(tool.name, operationName, error as Error);
    throw error;
  }
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
    destructiveHint: false,
  },
  operations: [
    OperationName.RENAME_FILE,
    OperationName.MOVE_FILE,
    OperationName.BATCH_MOVE_FILES,
  ],
  inputSchema: z
    .object({
      operation: z.enum([
        OperationName.RENAME_FILE,
        OperationName.MOVE_FILE,
        OperationName.BATCH_MOVE_FILES,
      ]),
      sourcePath: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Path of the file to act on. Required for rename_file and move_file.',
        ),
      name: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Required for rename_file: the new bare filename, e.g. "usages.ts" - not a path. To move a file into another directory, use move_file with destinationPath.',
        ),
      destinationPath: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Required for move_file: the full new path of the file, including its filename.',
        ),
      files: z
        .array(z.string().min(1))
        .optional()
        .describe('Required for batch_move_files: paths of the files to move.'),
      targetFolder: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Required for batch_move_files: directory the files are moved into.',
        ),
      preview: z
        .boolean()
        .optional()
        .describe('Report the edits that would be made without writing them.'),
    })
    .refine(
      (data) => {
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
      },
      (data) => {
        if (data.operation === OperationName.RENAME_FILE) {
          if (!data.sourcePath)
            return {
              message: `sourcePath is required for ${OperationName.RENAME_FILE}`,
            };
          if (!data.name)
            return {
              message: `name is required for ${OperationName.RENAME_FILE}`,
            };
        }
        if (data.operation === OperationName.MOVE_FILE) {
          if (!data.sourcePath)
            return {
              message: `sourcePath is required for ${OperationName.MOVE_FILE}`,
            };
          if (!data.destinationPath)
            return {
              message: `destinationPath is required for ${OperationName.MOVE_FILE}`,
            };
        }
        if (data.operation === OperationName.BATCH_MOVE_FILES) {
          if (!data.files)
            return {
              message: `files is required for ${OperationName.BATCH_MOVE_FILES}`,
            };
          if (!data.targetFolder)
            return {
              message: `targetFolder is required for ${OperationName.BATCH_MOVE_FILES}`,
            };
        }
        return { message: 'Invalid file operation parameters' };
      },
    ),
  async execute(args, registry) {
    return runOperation(fileOperationsTool, args, registry);
  },
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
    destructiveHint: false,
  },
  operations: [
    OperationName.ORGANIZE_IMPORTS,
    OperationName.FIX_ALL,
    OperationName.REMOVE_UNUSED,
  ],
  inputSchema: z.object({
    operation: z.enum([
      OperationName.ORGANIZE_IMPORTS,
      OperationName.FIX_ALL,
      OperationName.REMOVE_UNUSED,
    ]),
    filePath: z.string().min(1, 'File path cannot be empty'),
    preview: z.boolean().optional(),
  }),
  async execute(args, registry) {
    return runOperation(codeQualityTool, args, registry);
  },
};

// Refactoring Tool
export const refactoringTool: GroupedTool = {
  name: 'refactoring',
  title: 'Refactoring',
  description: `Rename symbols, extract functions, or move symbols to files (auto-updates imports).

vs Edit: Updates ALL refs (imports, JSDoc, dynamic imports). Impossible by hand.

Use when: Renaming, extracting, or moving symbols between files. Always use this.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
  operations: [
    OperationName.RENAME,
    OperationName.EXTRACT_FUNCTION,
    OperationName.EXTRACT_CONSTANT,
    OperationName.EXTRACT_VARIABLE,
    OperationName.MOVE_TO_FILE,
    OperationName.INFER_RETURN_TYPE,
  ],
  inputSchema: z
    .object({
      operation: z.enum([
        OperationName.RENAME,
        OperationName.EXTRACT_FUNCTION,
        OperationName.EXTRACT_CONSTANT,
        OperationName.EXTRACT_VARIABLE,
        OperationName.MOVE_TO_FILE,
        OperationName.INFER_RETURN_TYPE,
      ]),
      filePath: z.string().min(1, 'File path cannot be empty'),
      line: z.number().int().positive('Line must be a positive integer'),
      text: z.string().min(1, 'Text cannot be empty'),
      name: z
        .string()
        .optional()
        .describe(
          'Required for rename: the new symbol name. Optional for extract_function, extract_constant and extract_variable, which generate a name when omitted.',
        ),
      destinationPath: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Required for move_to_file: the file to move the symbol into. Created if it does not exist; omit to move into a new file named after the symbol.',
        ),
      preview: z
        .boolean()
        .optional()
        .describe('Report the edits that would be made without writing them.'),
    })
    .refine(
      (data) => {
        if (data.operation === OperationName.RENAME) return !!data.name;
        return true;
      },
      {
        message: `name is required for ${OperationName.RENAME} operation`,
      },
    ),
  async execute(args, registry) {
    return runOperation(refactoringTool, args, registry);
  },
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
    destructiveHint: true, // cleanup_codebase can delete files
  },
  operations: [
    OperationName.FIND_REFERENCES,
    OperationName.REFACTOR_MODULE,
    OperationName.CLEANUP_CODEBASE,
    OperationName.RESTART_TSSERVER,
  ],
  inputSchema: z
    .object({
      operation: z.enum([
        OperationName.FIND_REFERENCES,
        OperationName.REFACTOR_MODULE,
        OperationName.CLEANUP_CODEBASE,
        OperationName.RESTART_TSSERVER,
      ]),
      filePath: z
        .string()
        .min(1)
        .optional()
        .describe('Required for find_references: the file holding the symbol.'),
      line: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Required for find_references: 1-based line the symbol appears on.',
        ),
      text: z
        .string()
        .min(1)
        .optional()
        .describe('Required for find_references: the symbol to look up.'),
      sourcePath: z
        .string()
        .min(1)
        .optional()
        .describe('Required for refactor_module: the module to move.'),
      destinationPath: z
        .string()
        .min(1)
        .optional()
        .describe('Required for refactor_module: the path to move it to.'),
      directory: z
        .string()
        .min(1)
        .optional()
        .describe('Required for cleanup_codebase: the directory to sweep.'),
      deleteUnusedFiles: z
        .boolean()
        .optional()
        .describe(
          'cleanup_codebase only: DELETES files it judges unreachable. Requires entrypoints, which decide what counts as reachable.',
        ),
      entrypoints: z
        .array(z.string())
        .optional()
        .describe(
          'Required by cleanup_codebase when deleteUnusedFiles is true: regex patterns for the files reachability is traced from, e.g. ["src/main\\\\.ts$"].',
        ),
      preview: z
        .boolean()
        .optional()
        .describe(
          'Report the changes that would be made without applying them.',
        ),
    })
    .refine(
      (data) => {
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
      },
      (data) => {
        if (data.operation === OperationName.FIND_REFERENCES) {
          if (!data.filePath)
            return {
              message: `filePath is required for ${OperationName.FIND_REFERENCES}`,
            };
          if (data.line === undefined)
            return {
              message: `line is required for ${OperationName.FIND_REFERENCES}`,
            };
          if (!data.text)
            return {
              message: `text is required for ${OperationName.FIND_REFERENCES}`,
            };
        }
        if (data.operation === OperationName.REFACTOR_MODULE) {
          if (!data.sourcePath)
            return {
              message: `sourcePath is required for ${OperationName.REFACTOR_MODULE}`,
            };
          if (!data.destinationPath)
            return {
              message: `destinationPath is required for ${OperationName.REFACTOR_MODULE}`,
            };
        }
        if (data.operation === OperationName.CLEANUP_CODEBASE) {
          if (!data.directory)
            return {
              message: `directory is required for ${OperationName.CLEANUP_CODEBASE}`,
            };
          if (data.deleteUnusedFiles && !data.entrypoints)
            return {
              message: `entrypoints is required when deleteUnusedFiles: true to prevent accidental deletion. Specify your app's entry points like ["src/main\\\\.ts$"] or use defaults at your own risk.`,
            };
        }
        return { message: 'Invalid workspace operation parameters' };
      },
    ),
  async execute(args, registry) {
    return runOperation(workspaceTool, args, registry);
  },
};

export const groupedTools: GroupedTool[] = [
  fileOperationsTool,
  codeQualityTool,
  refactoringTool,
  workspaceTool,
];
