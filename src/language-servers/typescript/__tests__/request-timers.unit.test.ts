/**
 * Tests for the lifetime of a request's timeout timer.
 *
 * Nothing cleared these once the reply arrived, so every request left a timer
 * alive for its full 30 seconds. cleanup_codebase issues requests per file, so
 * a sweep over a large project accumulated thousands, each one an active
 * handle holding the event loop open.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { TypeScriptServer } from '../tsserver-client.js';

/** The request timeout is the only timer the client arms at this duration */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Replaces the global timer functions so the client's own calls can be
 * watched, since a Timeout reports nothing about itself once cleared.
 */
function trackRequestTimers() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const armed = new Set<unknown>();
  const stillPending = new Set<unknown>();
  const unrefed = new Set<unknown>();

  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const handle = realSetTimeout(...args);
    if (args[1] === REQUEST_TIMEOUT_MS) {
      armed.add(handle);
      stillPending.add(handle);
      const unref = handle.unref?.bind(handle);
      if (unref) {
        handle.unref = () => {
          unrefed.add(handle);
          return unref();
        };
      }
    }
    return handle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    stillPending.delete(handle);
    return realClearTimeout(handle);
  }) as typeof clearTimeout;

  return {
    armed,
    stillPending,
    unrefed,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

describe('TSServer request timers', () => {
  let tsServer: TypeScriptServer | null = null;

  afterEach(async () => {
    if (tsServer?.isRunning()) {
      await tsServer.stop();
    }
    tsServer = null;
  });

  it('should clear a request timer once the reply arrives', async () => {
    // Arrange - installed after start(), so only the request below is watched
    tsServer = new TypeScriptServer();
    await tsServer.start(process.cwd());
    const timers = trackRequestTimers();

    // Act
    try {
      await tsServer.sendRequest('configure', {
        preferences: { includeCompletionsForModuleExports: true },
      });
    } finally {
      timers.restore();
    }

    // Assert
    expect(timers.armed.size).toBe(1);
    expect(timers.stillPending.size).toBe(0);
  });

  it('should not let a request timer hold the process open', async () => {
    // Arrange
    tsServer = new TypeScriptServer();
    await tsServer.start(process.cwd());
    const timers = trackRequestTimers();

    // Act
    try {
      await tsServer.sendRequest('configure', {
        preferences: { includeCompletionsForModuleExports: true },
      });
    } finally {
      timers.restore();
    }

    // Assert
    expect(timers.unrefed).toEqual(timers.armed);
  });
});
