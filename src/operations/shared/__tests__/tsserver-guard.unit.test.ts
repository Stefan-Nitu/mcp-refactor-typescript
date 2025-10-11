import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TSServerGuard } from '../tsserver-guard.js';
import type { RefactorResult, TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';

describe('TSServerGuard', () => {
  let mockTsServer: TypeScriptServer;
  let guard: TSServerGuard;

  beforeEach(() => {
    mockTsServer = {
      isRunning: vi.fn(),
      start: vi.fn(),
      checkProjectLoaded: vi.fn()
    } as unknown as TypeScriptServer;

    guard = new TSServerGuard(mockTsServer);
  });

  describe('ensureReady', () => {
    it('should start server if not running', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(false);
      vi.mocked(mockTsServer.start).mockResolvedValue(undefined);
      vi.mocked(mockTsServer.checkProjectLoaded).mockResolvedValue(null);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(mockTsServer.isRunning).toHaveBeenCalled();
      expect(mockTsServer.start).toHaveBeenCalledWith(process.cwd());
      expect(mockTsServer.checkProjectLoaded).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should not start server if already running', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(true);
      vi.mocked(mockTsServer.checkProjectLoaded).mockResolvedValue(null);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(mockTsServer.isRunning).toHaveBeenCalled();
      expect(mockTsServer.start).not.toHaveBeenCalled();
      expect(mockTsServer.checkProjectLoaded).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return error result if project fails to load', async () => {
      // Arrange
      const errorResult: RefactorResult = {
        success: false,
        message: 'Project failed to load',
        filesChanged: []
      };
      vi.mocked(mockTsServer.isRunning).mockReturnValue(true);
      vi.mocked(mockTsServer.checkProjectLoaded).mockResolvedValue(errorResult);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(result).toBe(errorResult);
      expect(result?.success).toBe(false);
      expect(result?.message).toBe('Project failed to load');
    });

    it('should handle server start failure', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(false);
      vi.mocked(mockTsServer.start).mockRejectedValue(new Error('Failed to start'));

      // Act & Assert
      await expect(guard.ensureReady()).rejects.toThrow('Failed to start');
    });

    it('should check project loaded after starting server', async () => {
      // Arrange
      const callOrder: string[] = [];
      vi.mocked(mockTsServer.isRunning).mockReturnValue(false);
      vi.mocked(mockTsServer.start).mockImplementation(async () => {
        callOrder.push('start');
      });
      vi.mocked(mockTsServer.checkProjectLoaded).mockImplementation(async () => {
        callOrder.push('checkProjectLoaded');
        return null;
      });

      // Act
      await guard.ensureReady();

      // Assert
      expect(callOrder).toEqual(['start', 'checkProjectLoaded']);
    });

    it('should return null when server is ready and project loaded', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(true);
      vi.mocked(mockTsServer.checkProjectLoaded).mockResolvedValue(null);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(result).toBeNull();
    });
  });
});
