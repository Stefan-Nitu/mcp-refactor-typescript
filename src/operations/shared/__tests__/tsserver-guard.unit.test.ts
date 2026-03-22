import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { TSServerGuard } from '../tsserver-guard.js';

describe('TSServerGuard', () => {
  let mockTsServer: TypeScriptServer;
  let guard: TSServerGuard;
  const isRunningMock = mock();
  const startMock = mock();
  const isProjectLoadedMock = mock();

  beforeEach(() => {
    isRunningMock.mockReset();
    startMock.mockReset();
    isProjectLoadedMock.mockReset();

    mockTsServer = {
      isRunning: isRunningMock,
      start: startMock,
      isProjectLoaded: isProjectLoadedMock,
    } as unknown as TypeScriptServer;

    guard = new TSServerGuard(mockTsServer);
  });

  describe('ensureReady', () => {
    it('should start server if not running and wait for project to load', async () => {
      // Arrange
      isRunningMock.mockReturnValue(false);
      startMock.mockResolvedValue(undefined);
      isProjectLoadedMock.mockReturnValue(true);

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
      isRunningMock.mockReturnValue(true);
      isProjectLoadedMock.mockReturnValue(true);

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
      isRunningMock.mockReturnValue(true);
      isProjectLoadedMock.mockReturnValue(false);

      // Act
      const result = await guard.ensureReady(100);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.message).toContain('still indexing');
    });

    it('should handle server start failure', async () => {
      // Arrange
      isRunningMock.mockReturnValue(false);
      startMock.mockRejectedValue(new Error('Failed to start'));

      // Act & Assert
      await expect(guard.ensureReady()).rejects.toThrow('Failed to start');
    });

    it('should check project loaded after starting server', async () => {
      // Arrange
      const callOrder: string[] = [];
      isRunningMock.mockReturnValue(false);
      startMock.mockImplementation(async () => {
        callOrder.push('start');
      });
      isProjectLoadedMock.mockImplementation(() => {
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
      isRunningMock.mockReturnValue(true);
      isProjectLoadedMock.mockReturnValue(true);

      // Act
      const result = await guard.ensureReady();

      // Assert
      expect(result).toBeNull();
    });

    it('should wait for project to load within timeout', async () => {
      // Arrange
      let callCount = 0;
      isRunningMock.mockReturnValue(true);
      isProjectLoadedMock.mockImplementation(() => {
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
