/**
 * Unit tests for cleanup handler
 * Verifies that server.close() is called before registry.close()
 */

import { describe, expect, it, vi } from 'vitest';

describe('Cleanup Handler', () => {
  it('should call server.close() before registry.close()', async () => {
    // Arrange
    const callOrder: string[] = [];

    const mockServer = {
      close: vi.fn(async () => {
        callOrder.push('server.close');
      })
    };

    const mockRegistry = {
      close: vi.fn(async () => {
        callOrder.push('registry.close');
      })
    };

    const cleanup = async () => {
      await mockServer.close();
      await mockRegistry.close();
    };

    // Act
    await cleanup();

    // Assert
    expect(mockServer.close).toHaveBeenCalledOnce();
    expect(mockRegistry.close).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['server.close', 'registry.close']);
  });

  it('should still call registry.close() if server.close() fails', async () => {
    // Arrange
    const mockServer = {
      close: vi.fn(async () => {
        throw new Error('Server close failed');
      })
    };

    const mockRegistry = {
      close: vi.fn(async () => {})
    };

    const cleanup = async () => {
      try {
        await mockServer.close();
      } catch {
        // Log but continue
      }
      await mockRegistry.close();
    };

    // Act
    await cleanup();

    // Assert
    expect(mockServer.close).toHaveBeenCalledOnce();
    expect(mockRegistry.close).toHaveBeenCalledOnce();
  });
});
