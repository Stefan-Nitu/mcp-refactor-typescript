/**
 * Operation names enum
 * Single source of truth for all operation identifiers
 */

export enum OperationName {
  RENAME = 'rename',
  RENAME_FILE = 'rename_file',
  MOVE_FILE = 'move_file',
  BATCH_MOVE_FILES = 'batch_move_files',
  ORGANIZE_IMPORTS = 'organize_imports',
  FIX_ALL = 'fix_all',
  REMOVE_UNUSED = 'remove_unused',
  FIND_REFERENCES = 'find_references',
  EXTRACT_FUNCTION = 'extract_function',
  EXTRACT_CONSTANT = 'extract_constant',
  EXTRACT_VARIABLE = 'extract_variable',
  INFER_RETURN_TYPE = 'infer_return_type',
  REFACTOR_MODULE = 'refactor_module',
  CLEANUP_CODEBASE = 'cleanup_codebase',
  RESTART_TSSERVER = 'restart_tsserver'
}
