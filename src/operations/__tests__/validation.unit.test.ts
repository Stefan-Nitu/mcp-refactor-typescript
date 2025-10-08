import { describe, expect, it } from 'vitest';
import { batchMoveFilesSchema } from '../batch-move-files.js';
import { extractFunctionSchema } from '../extract-function.js';
import { findReferencesSchema } from '../find-references.js';
import { fixAllSchema } from '../fix-all.js';
import { inferReturnTypeSchema } from '../infer-return-type.js';
import { inlineVariableSchema } from '../inline-variable.js';
import { moveFileSchema } from '../move-file.js';
import { organizeImportsSchema } from '../organize-imports.js';
import { removeUnusedSchema } from '../remove-unused.js';
import { renameSchema } from '../rename.js';

describe('Schema Validation', () => {
  describe('renameSchema', () => {
    it('should validate correct input', () => {
      const result = renameSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'oldName',
        newName: 'newVariableName'
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing filePath', () => {
      const result = renameSchema.safeParse({
        line: 10,
        text: 'oldName',
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
        text: 'oldName',
        newName: 'newName'
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty newName', () => {
      const result = renameSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'oldName',
        newName: ''
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative line numbers', () => {
      const result = renameSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: -1,
        text: 'oldName',
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
        text: 'identifier'
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
        text: 'identifier'
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty text', () => {
      const result = findReferencesSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: ''
      });
      expect(result.success).toBe(false);
    });
  });

  describe('extractFunctionSchema', () => {
    it('should validate correct input', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'codeToExtract'
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional functionName', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'codeToExtract',
        functionName: 'myFunction'
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty text', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: ''
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative positions', () => {
      const result = extractFunctionSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: -1,
        text: 'codeToExtract'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('inlineVariableSchema', () => {
    it('should validate correct input', () => {
      const result = inlineVariableSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'variableName'
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional preview', () => {
      const result = inlineVariableSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'variableName',
        preview: true
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty text', () => {
      const result = inlineVariableSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: ''
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative positions', () => {
      const result = inlineVariableSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: -1,
        text: 'variableName'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('inferReturnTypeSchema', () => {
    it('should validate correct input', () => {
      const result = inferReturnTypeSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'functionName'
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional preview', () => {
      const result = inferReturnTypeSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: 'functionName',
        preview: true
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty text', () => {
      const result = inferReturnTypeSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: 10,
        text: ''
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative positions', () => {
      const result = inferReturnTypeSchema.safeParse({
        filePath: '/path/to/file.ts',
        line: -1,
        text: 'functionName'
      });
      expect(result.success).toBe(false);
    });
  });
});
