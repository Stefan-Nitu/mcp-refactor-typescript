import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { RenameOperation } from '../rename.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn()
}));

describe('Rename Operation Business Logic', () => {
  let mockServer: TypeScriptServer;
  let operation: RenameOperation;

  beforeEach(async () => {
    // Import the mocked module
    const { readFile, writeFile } = await import('fs/promises');

    // Setup file system mocks
    vi.mocked(readFile).mockResolvedValue('export function oldName() {}');
    vi.mocked(writeFile).mockResolvedValue(undefined);

    // Create a mock TypeScriptServer
    mockServer = {
      isRunning: vi.fn().mockReturnValue(true),
      start: vi.fn().mockResolvedValue(undefined),
      checkProjectLoaded: vi.fn().mockResolvedValue(null),
      openFile: vi.fn().mockResolvedValue(undefined),
      discoverAndOpenImportingFiles: vi.fn().mockResolvedValue(undefined),
      waitForProjectUpdate: vi.fn().mockResolvedValue(undefined),
      isProjectLoaded: vi.fn().mockReturnValue(true),
      sendRequest: vi.fn()
    } as unknown as TypeScriptServer;

    operation = new RenameOperation(mockServer);
  });

  describe('incomplete indexing warning', () => {
    it('should include warning when project is not fully loaded', async () => {
      // Arrange - Mock incomplete indexing
      vi.mocked(mockServer.isProjectLoaded).mockReturnValue(false);
      vi.mocked(mockServer.sendRequest).mockResolvedValue({
        locs: [{
          file: '/test/file.ts',
          locs: [{
            start: { line: 1, offset: 17 },
            end: { line: 1, offset: 24 }
          }]
        }]
      });

      // Act
      const response = await operation.execute({
        filePath: '/test/file.ts',
        line: 1,
        column: 17,
        newName: 'newName'
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).toContain('TypeScript is still indexing');
      expect(response.message).toContain('Some references may have been missed');
    });

    it('should NOT include warning when project is fully loaded', async () => {
      // Arrange - Mock complete indexing
      vi.mocked(mockServer.isProjectLoaded).mockReturnValue(true);
      vi.mocked(mockServer.sendRequest).mockResolvedValue({
        locs: [{
          file: '/test/file.ts',
          locs: [{
            start: { line: 1, offset: 17 },
            end: { line: 1, offset: 24 }
          }]
        }]
      });

      // Act
      const response = await operation.execute({
        filePath: '/test/file.ts',
        line: 1,
        column: 17,
        newName: 'newName'
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).not.toContain('TypeScript is still indexing');
      expect(response.message).toBe('Renamed to "newName"');
    });

    it('should include warning in preview mode when indexing incomplete', async () => {
      // Arrange
      vi.mocked(mockServer.isProjectLoaded).mockReturnValue(false);
      vi.mocked(mockServer.sendRequest).mockResolvedValue({
        locs: [{
          file: '/test/file.ts',
          locs: [{
            start: { line: 1, offset: 17 },
            end: { line: 1, offset: 24 }
          }]
        }]
      });

      // Act
      const response = await operation.execute({
        filePath: '/test/file.ts',
        line: 1,
        column: 17,
        newName: 'newName',
        preview: true
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).toContain('Preview:');
      expect(response.message).toContain('TypeScript is still indexing');
      expect(response.preview).toBeDefined();
    });
  });
});
