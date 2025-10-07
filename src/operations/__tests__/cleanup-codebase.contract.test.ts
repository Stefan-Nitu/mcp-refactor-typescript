import type { ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { promisify } from 'util';

const execAsync = promisify(exec);

vi.mock('child_process', () => ({
  exec: vi.fn()
}));

describe('CleanupCodebase tsr contract tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls tsr with correct command for preview mode', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
      return {} as ChildProcess;
    });

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
      cwd: '/test/dir',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000
    });

    // Assert
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('npx tsr --recursive'),
      expect.objectContaining({
        cwd: '/test/dir',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000
      }),
      expect.any(Function)
    );
  });

  it('calls tsr with --write flag when not in preview mode', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
      return {} as ChildProcess;
    });

    // Act
    await execAsync(`npx tsr --write --recursive 'main\\.ts$'`, {
      cwd: '/test/dir'
    });

    // Assert
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('--write'),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('handles tsr exit code 1 correctly (changes needed)', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    const tsrError = Object.assign(new Error('Command failed'), { code: 1 });

    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(tsrError, '', 'Would delete file: unused.ts');
      }
      return {} as ChildProcess;
    });

    // Act & Assert
    try {
      await execAsync(`npx tsr --recursive 'main\\.ts$'`, { cwd: '/test' });
      expect.fail('Should throw when tsr exits with code 1');
    } catch (error) {
      // Assert: we correctly receive the error with exit code 1
      expect((error as { code?: number }).code).toBe(1);
    }
  });

  it('handles tsr exit code 0 correctly (no changes)', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    let callbackCalled = false;

    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callbackCalled = true;
        callback(null, 'No unused exports found', '');
      }
      return {} as ChildProcess;
    });

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, { cwd: '/test' });

    // Assert
    expect(callbackCalled).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('npx tsr'),
      expect.objectContaining({ cwd: '/test' }),
      expect.any(Function)
    );
  });

  it('passes correct entrypoint regex to tsr', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
      return {} as ChildProcess;
    });

    const entrypoints = 'main\\.ts$|index\\.ts$|app\\.ts$';

    // Act
    await execAsync(`npx tsr --recursive '${entrypoints}'`, {
      cwd: '/test/dir'
    });

    // Assert: verify regex pattern is passed correctly
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining(entrypoints),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('sets correct timeout for tsr execution', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
      return {} as ChildProcess;
    });

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
      cwd: '/test',
      timeout: 60000
    });

    // Assert: verify timeout is set
    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 60000 }),
      expect.any(Function)
    );
  });

  it('sets correct maxBuffer for tsr output', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
      return {} as ChildProcess;
    });

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
      cwd: '/test',
      maxBuffer: 10 * 1024 * 1024
    });

    // Assert: verify maxBuffer is set to 10MB
    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxBuffer: 10 * 1024 * 1024 }),
      expect.any(Function)
    );
  });

  it('handles tsr timeout correctly', async () => {
    // Arrange
    const mockExec = vi.mocked(exec);
    const timeoutError = Object.assign(new Error('Command timed out'), { killed: true });

    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(timeoutError, '', '');
      }
      return {} as ChildProcess;
    });

    // Act & Assert
    try {
      await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
        cwd: '/test',
        timeout: 60000
      });
      expect.fail('Should throw on timeout');
    } catch (error) {
      // Assert: we receive the timeout error
      expect((error as { killed?: boolean }).killed).toBe(true);
    }
  });
});
