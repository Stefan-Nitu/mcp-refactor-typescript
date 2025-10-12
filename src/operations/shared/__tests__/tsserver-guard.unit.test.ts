import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TSServerGuard } from '../tsserver-guard.js';
import type { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';

describe('TSServerGuard', () => {
  let mockTsServer: TypeScriptServer;
  let guard: TSServerGuard;

  beforeEach(() => {
    mockTsServer = {
      isRunning: vi.fn(),
      start: vi.fn(),
      isProjectLoaded: vi.fn()
    } as unknown as TypeScriptServer;

    guard = new TSServerGuard(mockTsServer);
  });

  describe('ensureReady', () => {
    it('should start server if not running and wait for project to load', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(false);
      vi.mocked(mockTsServer.start).mockResolvedValue(undefined);
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(true);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(mockTsServer.isRunning).toHaveBeenCalled();
      expect(mockTsServer.start).toHaveBeenCalledWith(process.cwd());
      expect(mockTsServer.isProjectLoaded).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should not start server if already running', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(true);
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(true);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(mockTsServer.isRunning).toHaveBeenCalled();
      expect(mockTsServer.start).not.toHaveBeenCalled();
      expect(mockTsServer.isProjectLoaded).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return error result if project loading times out', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(true);
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(false);

      // Act
      const result = await guard.ensureReady(100);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.message).toContain('still indexing');
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
      vi.mocked(mockTsServer.isProjectLoaded).mockImplementation(() => {
        callOrder.push('isProjectLoaded');
        return true;
      });

      // Act
      await guard.ensureReady();

      // Assert
      expect(callOrder).toEqual(['start', 'isProjectLoaded']);
    });

    it('should return null when server is ready and project loaded', async () => {
      // Arrange
      vi.mocked(mockTsServer.isRunning).mockReturnValue(true);
      vi.mocked(mockTsServer.isProjectLoaded).mockReturnValue(true);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(result).toBeNull();
    });

    it('should wait for project to load within timeout', async () => {
      // Arrange
      let callCount = 0;
      vi.mocked(mockTsServer.isRunning).mockReturnValue(true);
      vi.mocked(mockTsServer.isProjectLoaded).mockImplementation(() => {
        callCount++;
        return callCount > 2;
      });

      // Act
      const result = await guard.ensureReady(1000);

      // Assert
      expect(result).toBeNull();
      expect(callCount).toBeGreaterThan(1);
    });
  });
});
