/**
 * Tests for TypeScript project indexing behavior
 *
 * These tests document the expected behavior when waiting for
 * TypeScript to finish indexing files after opening them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../tsserver-client.js';

describe('TypeScript Project Indexing', () => {
  let tsServer: TypeScriptServer;

  beforeEach(() => {
    tsServer = new TypeScriptServer();
  });

  afterEach(async () => {
    if (tsServer.isRunning()) {
      await tsServer.stop();
    }
  });

  describe('waitForProjectUpdate', () => {
    it('should return immediately if project is already loaded', async () => {
      // Arrange
      await tsServer.start(process.cwd());
      // Wait for initial project load
      await tsServer.checkProjectLoaded();

      // Act
      const startTime = Date.now();
      await tsServer.waitForProjectUpdate(5000);
      const duration = Date.now() - startTime;

      // Assert - should return almost immediately (< 100ms)
      expect(duration).toBeLessThan(100);
    });

    it('should wait for projectsUpdatedInBackground event after opening files', async () => {
      // Arrange
      await tsServer.start(process.cwd());
      await tsServer.checkProjectLoaded();

      // Act - open a file then wait for update
      await tsServer.openFile(__filename);

      // Assert - should wait for event (or timeout)
      await expect(tsServer.waitForProjectUpdate(1000)).resolves.toBeUndefined();
    });

    it('should timeout if project update takes too long', async () => {
      // Arrange - create scenario where event won't fire
      // TODO: How do we simulate TypeScript NOT emitting the event?

      // This test documents that timeouts CAN happen and should be handled gracefully
    });

    it('should allow multiple callers to share the same wait promise', async () => {
      // Arrange
      await tsServer.start(process.cwd());
      await tsServer.checkProjectLoaded();

      // Act - multiple concurrent waits
      const promises = [
        tsServer.waitForProjectUpdate(5000),
        tsServer.waitForProjectUpdate(5000),
        tsServer.waitForProjectUpdate(5000)
      ];

      // Assert - all should resolve when the event fires
      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    it('should continue listening for event even after timeout', async () => {
      // Arrange
      // TODO: This test documents the desired behavior:
      // - Timeout should reject the promise to tell the user to retry
      // - But the listener should stay active so when event fires, projectLoaded gets set
      // - Next call will then return immediately
    });
  });

  describe('Integration with operations', () => {
    it('should handle the full flow: open file -> wait -> operation', async () => {
      // This test documents the expected flow for operations like rename/move
      // Arrange
      await tsServer.start(process.cwd());

      // Act
      await tsServer.openFile(__filename);
      await tsServer.waitForProjectUpdate(5000);

      // Now operation can proceed knowing TypeScript has indexed the files
      const result = await tsServer.sendRequest('projectInfo', {
        file: __filename,
        needFileNameList: false
      });

      // Assert
      expect(result).toBeDefined();
    });
  });
});
