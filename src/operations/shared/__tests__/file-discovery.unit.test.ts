import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { FileDiscovery } from '../file-discovery.js';

describe('FileDiscovery', () => {
  let mockTsServer: TypeScriptServer;
  let fileDiscovery: FileDiscovery;

  beforeEach(() => {
    mockTsServer = {
      openFile: vi.fn(),
      sendRequest: vi.fn(),
      isProjectLoaded: vi.fn()
    } as unknown as TypeScriptServer;

    fileDiscovery = new FileDiscovery(mockTsServer);
  });

  describe('discoverRelatedFiles', () => {
    it('should open file and discover importing files via sendRequest', async () => {
      // Arrange
      const filePath = '/test/file.ts';
      vi.mocked(mockTsServer.openFile).mockResolvedValue(undefined);
      vi.mocked(mockTsServer.sendRequest).mockResolvedValue({
        refs: [
          { file: '/test/importer1.ts' },
          { file: '/test/importer2.ts' }
        ]
      });
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(true);

      // Act
      const status = await fileDiscovery.discoverRelatedFiles(filePath);

      // Assert
      expect(mockTsServer.openFile).toHaveBeenCalledWith(filePath);
      expect(mockTsServer.sendRequest).toHaveBeenCalledWith('fileReferences', {
        file: filePath
      });
      expect(mockTsServer.openFile).toHaveBeenCalledWith('/test/importer1.ts');
      expect(mockTsServer.openFile).toHaveBeenCalledWith('/test/importer2.ts');
      expect(status).toEqual({
        isFullyLoaded: true,
        didScanTimeout: false
      });
    });

    it('should silently handle discovery errors and still return status', async () => {
      // Arrange
      const filePath = '/test/file.ts';
      vi.mocked(mockTsServer.openFile).mockResolvedValue(undefined);
      vi.mocked(mockTsServer.sendRequest).mockRejectedValue(new Error('Discovery failed'));
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(false);

      // Act
      const status = await fileDiscovery.discoverRelatedFiles(filePath);

      // Assert
      expect(status).toEqual({
        isFullyLoaded: false,
        didScanTimeout: false
      });
    });

    it('should handle array of file paths', async () => {
      // Arrange
      const files = ['/test/file1.ts', '/test/file2.ts'];
      vi.mocked(mockTsServer.openFile).mockResolvedValue(undefined);
      vi.mocked(mockTsServer.sendRequest).mockResolvedValue({ refs: [] });
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(true);

      // Act
      const status = await fileDiscovery.discoverRelatedFiles(files);

      // Assert
      expect(mockTsServer.openFile).toHaveBeenCalledTimes(2);
      expect(mockTsServer.openFile).toHaveBeenCalledWith('/test/file1.ts');
      expect(mockTsServer.openFile).toHaveBeenCalledWith('/test/file2.ts');
      expect(status).toEqual({
        isFullyLoaded: true,
        didScanTimeout: false
      });
    });

    it('should return correct status when project not fully loaded', async () => {
      // Arrange
      const filePath = '/test/file.ts';
      vi.mocked(mockTsServer.openFile).mockResolvedValue(undefined);
      vi.mocked(mockTsServer.sendRequest).mockResolvedValue({ refs: [] });
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(false);

      // Act
      const status = await fileDiscovery.discoverRelatedFiles(filePath);

      // Assert
      expect(status).toEqual({
        isFullyLoaded: false,
        didScanTimeout: false
      });
    });

    it('should not open target file as importing file', async () => {
      // Arrange
      const filePath = '/test/utils.ts';
      vi.mocked(mockTsServer.openFile).mockResolvedValue(undefined);
      vi.mocked(mockTsServer.sendRequest).mockResolvedValue({
        refs: [
          { file: '/test/importer.ts' },
          { file: filePath }
        ]
      });
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(true);

      // Act
      await fileDiscovery.discoverRelatedFiles(filePath);

      // Assert
      expect(mockTsServer.openFile).toHaveBeenCalledWith(filePath);
      expect(mockTsServer.openFile).toHaveBeenCalledWith('/test/importer.ts');
      expect(mockTsServer.openFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('buildWarningMessage', () => {
    it('should return empty string when project is fully loaded and no timeout', () => {
      // Arrange
      const status = { isFullyLoaded: true, didScanTimeout: false };
      const context = 'references';

      // Act
      const message = fileDiscovery.buildWarningMessage(status, context);

      // Assert
      expect(message).toBe('');
    });

    it('should warn when project is not fully loaded', () => {
      // Arrange
      const status = { isFullyLoaded: false, didScanTimeout: false };
      const context = 'references';

      // Act
      const message = fileDiscovery.buildWarningMessage(status, context);

      // Assert
      expect(message).toContain('Warning: TypeScript is still indexing the project');
      expect(message).toContain('Some references may have been missed');
      expect(message).toContain('If results seem incomplete, try running the operation again');
    });

    it('should warn when scan timed out', () => {
      // Arrange
      const status = { isFullyLoaded: true, didScanTimeout: true };
      const context = 'import updates';

      // Act
      const message = fileDiscovery.buildWarningMessage(status, context);

      // Assert
      expect(message).toContain('Warning: File discovery timed out');
      expect(message).toContain('Import updates might be incomplete');
      expect(message).toContain('If results seem incomplete, try running the operation again');
    });

    it('should combine warnings when both conditions are true', () => {
      // Arrange
      const status = { isFullyLoaded: false, didScanTimeout: true };
      const context = 'references';

      // Act
      const message = fileDiscovery.buildWarningMessage(status, context);

      // Assert
      expect(message).toContain('Warning: TypeScript is still indexing the project');
      expect(message).toContain('Warning: File discovery timed out');
      expect(message).toContain('If results seem incomplete, try running the operation again');
    });

    it('should use provided context in warning messages', () => {
      // Arrange
      const status = { isFullyLoaded: false, didScanTimeout: false };
      const context = 'custom updates';

      // Act
      const message = fileDiscovery.buildWarningMessage(status, context);

      // Assert
      expect(message).toContain('Some custom updates may have been missed');
    });
  });
});
