import { describe, it, expect } from 'vitest';
import { renameSchema } from '../rename.js';
import { moveFileSchema } from '../move-file.js';
import { batchMoveFilesSchema } from '../batch-move-files.js';
import { organizeImportsSchema } from '../organize-imports.js';
import { fixAllSchema } from '../fix-all.js';
import { removeUnusedSchema } from '../remove-unused.js';
import { findReferencesSchema } from '../find-references.js';
import { extractFunctionSchema } from '../extract-function.js';

describe('Schema Validation', () => {
  describe('renameSchema', () => {
    it('should validate correct input', () => {
      const result = renameSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        column: 5,
        newName: 'newVariableName'
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing filePath', () => {
      const result = renameSchema.safeParse({
        line: 10,
        column: 5,
        newName: 'newName'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].path).toContain('filePath');
      }
    });

    it('should reject non-number line', () => {
      const result = renameSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: '10',
        column: 5,
        newName: 'newName'
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty newName', () => {
      const result = renameSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        column: 5,
        newName: ''
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative line numbers', () => {
      const result = renameSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: -1,
        column: 5,
        newName: 'newName'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('moveFileSchema', () => {
    it('should validate correct input', () => {
      const result = moveFileSchema.safeParse({
        sourcePath: '/path/to/source.ts',
        destinationPath: '/path/to/dest.ts'
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing sourcePath', () => {
      const result = moveFileSchema.safeParse({
        destinationPath: '/path/to/dest.ts'
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty strings', () => {
      const result = moveFileSchema.safeParse({
        sourcePath: '',
        destinationPath: '/path/to/dest.ts'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('batchMoveFilesSchema', () => {
    it('should validate correct input', () => {
      const result = batchMoveFilesSchema.safeParse({
        files: ['/path/to/file1.ts', '/path/to/file2.ts'],
        targetFolder: '/path/to/folder'
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty files array', () => {
      const result = batchMoveFilesSchema.safeParse({
        files: [],
        targetFolder: '/path/to/folder'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('At least one file');
      }
    });

    it('should reject non-array files', () => {
      const result = batchMoveFilesSchema.safeParse({
        files: '/path/to/file.ts',
        targetFolder: '/path/to/folder'
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty targetFolder', () => {
      const result = batchMoveFilesSchema.safeParse({
        files: ['/path/to/file.ts'],
        targetFolder: ''
      });
      expect(result.success).toBe(false);
    });
  });

  describe('organizeImportsSchema', () => {
    it('should validate correct input', () => {
      const result = organizeImportsSchema.safeParse({
        filePath: '/path/to/file.ts'
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing filePath', () => {
      const result = organizeImportsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject empty filePath', () => {
      const result = organizeImportsSchema.safeParse({
        filePath: ''
      });
      expect(result.success).toBe(false);
    });
  });

  describe('fixAllSchema', () => {
    it('should validate correct input', () => {
      const result = fixAllSchema.safeParse({
        filePath: '/path/to/file.ts'
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing filePath', () => {
      const result = fixAllSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('removeUnusedSchema', () => {
    it('should validate correct input', () => {
      const result = removeUnusedSchema.safeParse({
        filePath: '/path/to/file.ts'
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing filePath', () => {
      const result = removeUnusedSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('findReferencesSchema', () => {
    it('should validate correct input', () => {
      const result = findReferencesSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        column: 5
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing position info', () => {
      const result = findReferencesSchema.safeParse({
        filePath: '/path/to/file.ts'
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative positions', () => {
      const result = findReferencesSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: -1,
        column: 5
      });
      expect(result.success).toBe(false);
    });
  });

  describe('extractFunctionSchema', () => {
    it('should validate correct input', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        startLine: 10,
        startColumn: 5,
        endLine: 15,
        endColumn: 10
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional functionName', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        startLine: 10,
        startColumn: 5,
        endLine: 15,
        endColumn: 10,
        functionName: 'myFunction'
      });
      expect(result.success).toBe(true);
    });

    it('should reject when endLine < startLine', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        startLine: 15,
        startColumn: 5,
        endLine: 10,
        endColumn: 10
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative positions', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        startLine: -1,
        startColumn: 5,
        endLine: 15,
        endColumn: 10
      });
      expect(result.success).toBe(false);
    });
  });
});
