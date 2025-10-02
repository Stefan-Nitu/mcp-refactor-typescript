import { z } from 'zod';

// Define available actions
const TYPESCRIPT_ACTIONS = [
  'rename',
  'move_file',
  'extract_function',
  'extract_variable',
  'organize_imports',
  'fix_all',
  'remove_unused'
] as const;

type TypeScriptAction = typeof TYPESCRIPT_ACTIONS[number];

// Export for use in main index.ts
export const TYPESCRIPT_TOOL_DESCRIPTION = `TypeScript/JavaScript refactoring actions: ${TYPESCRIPT_ACTIONS.join(', ')}`;

// Schema for MCP tool registration
export const typescriptInputSchema = {
  action: z.enum(TYPESCRIPT_ACTIONS).describe(`Refactoring action: ${TYPESCRIPT_ACTIONS.join(', ')}`),
  filePath: z.string().describe('Absolute path to the TypeScript/JavaScript file'),

  // Position parameters (for rename)
  line: z.number().min(1).optional().describe('Line number (1-based) for rename action'),
  column: z.number().min(1).optional().describe('Column number (1-based) for rename action'),
  newName: z.string().optional().describe('New name for rename action'),

  // Range parameters (for extract actions)
  startLine: z.number().min(1).optional().describe('Start line of selection (1-based)'),
  startColumn: z.number().min(1).optional().describe('Start column of selection (1-based)'),
  endLine: z.number().min(1).optional().describe('End line of selection (1-based)'),
  endColumn: z.number().min(1).optional().describe('End column of selection (1-based)'),

  // Optional names for extracted items
  functionName: z.string().optional().describe('Name for extracted function'),
  variableName: z.string().optional().describe('Name for extracted variable'),

  // Move file parameters
  destinationPath: z.string().optional().describe('Destination path for move_file action')
};

// Router that delegates to appropriate action handlers
export async function handleTypeScript(args: any) {
  // Basic validation
  if (!args || typeof args !== 'object' || !args.action || !args.filePath) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          tool: 'typescript',
          action: 'unknown',
          status: 'error',
          error: 'Invalid input: action and filePath are required'
        }, null, 2)
      }]
    };
  }

  switch (args.action) {
    case 'rename': {
      if (!args.line || !args.column || !args.newName) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: rename requires line, column, and newName parameters'
          }]
        };
      }
      const { rename } = await import('./rename.js');
      return await rename(args.filePath, args.line, args.column, args.newName);
    }

    case 'move_file': {
      if (!args.destinationPath) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: move_file requires destinationPath parameter'
          }]
        };
      }
      const { moveFile } = await import('./move-file.js');
      return await moveFile(args.filePath, args.destinationPath);
    }

    case 'extract_function': {
      if (!args.startLine || !args.startColumn || !args.endLine || !args.endColumn) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: extract_function requires startLine, startColumn, endLine, and endColumn parameters'
          }]
        };
      }
      const { extractFunction } = await import('./extract-function.js');
      return await extractFunction(
        args.filePath,
        args.startLine,
        args.startColumn,
        args.endLine,
        args.endColumn,
        args.functionName
      );
    }

    case 'extract_variable': {
      if (!args.startLine || !args.startColumn || !args.endLine || !args.endColumn) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: extract_variable requires startLine, startColumn, endLine, and endColumn parameters'
          }]
        };
      }
      const { extractVariable } = await import('./extract-variable.js');
      return await extractVariable(
        args.filePath,
        args.startLine,
        args.startColumn,
        args.endLine,
        args.endColumn,
        args.variableName
      );
    }

    case 'organize_imports': {
      const { organizeImports } = await import('./organize-imports.js');
      return await organizeImports(args.filePath);
    }

    case 'fix_all': {
      const { fixAll } = await import('./fix-all.js');
      return await fixAll(args.filePath);
    }

    case 'remove_unused': {
      const { removeUnused } = await import('./remove-unused.js');
      return await removeUnused(args.filePath);
    }

    default:
      return {
        content: [{
          type: 'text' as const,
          text: `Error: Unknown action: ${args.action}`
        }]
      };
  }
}