/**
 * Tests for TypeScript project indexing behavior
 *
 * These tests document TSServer's simple project loading state tracking.
 * For readiness checking and waiting logic, see tsserver-guard.unit.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TSServerGuard } from '../../../operations/shared/tsserver-guard.js';
import { TypeScriptServer } from '../tsserver-client.js';

describe('TypeScript Project Indexing', () => {
  let tsServer: TypeScriptServer;
  let guard: TSServerGuard;

  beforeEach(() => {
    tsServer = new TypeScriptServer();
    guard = new TSServerGuard(tsServer);
  });

  afterEach(async () => {
    if (tsServer.isRunning()) {
      await tsServer.stop();
    }
  });

  describe('TSServer project loaded state', () => {
    it('should track project loading via events', async () => {
      // Arrange & Act
      await tsServer.start(process.cwd());
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert
      expect(tsServer.isProjectLoaded()).toBe(true);
    });
  });

  describe('TSServerGuard readiness checking', () => {
    it('should wait for project to load with timeout', async () => {
      // Arrange & Act
      const result = await guard.ensureReady(10000);

      // Assert
      expect(result).toBeNull();
      expect(tsServer.isProjectLoaded()).toBe(true);
    });

    it('should return immediately if project already loaded', async () => {
      // Arrange
      await guard.ensureReady(10000);

      // Act
      const startTime = Date.now();
      const result = await guard.ensureReady(10000);
      const duration = Date.now() - startTime;

      // Assert
      expect(result).toBeNull();
      expect(duration).toBeLessThan(100);
    });

    it('should timeout if project takes too long to load', async () => {
      // Arrange
      await tsServer.start(process.cwd());

      // Act - very short timeout to force timeout
      const result = await guard.ensureReady(1);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.message).toContain('still indexing');
    });
  });

  describe('Integration with operations', () => {
    it('should handle the full flow: ensure ready -> open file -> operation', async () => {
      // Arrange
      await guard.ensureReady(10000);

      // Act
      await tsServer.openFile(__filename);
      const result = await tsServer.sendRequest('projectInfo', {
        file: __filename,
        needFileNameList: false
      });

      // Assert
      expect(result).toBeDefined();
    });
  });
});
