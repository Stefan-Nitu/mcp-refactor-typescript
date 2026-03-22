import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execMock = mock();
mock.module('child_process', () => ({
  exec: execMock,
}));

const execAsync = promisify(exec);

describe('CleanupCodebase tsr contract tests', () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it('calls tsr with correct command for preview mode', async () => {
    // Arrange
    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ChildProcess;
      },
    );

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
      cwd: '/test/dir',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    // Assert
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('npx tsr --recursive'),
      expect.objectContaining({
        cwd: '/test/dir',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
      }),
      expect.any(Function),
    );
  });

  it('calls tsr with --write flag when not in preview mode', async () => {
    // Arrange
    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ChildProcess;
      },
    );

    // Act
    await execAsync(`npx tsr --write --recursive 'main\\.ts$'`, {
      cwd: '/test/dir',
    });

    // Assert
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('--write'),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('handles tsr exit code 1 correctly (changes needed)', async () => {
    // Arrange
    const tsrError = Object.assign(new Error('Command failed'), { code: 1 });

    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(tsrError, '', 'Would delete file: unused.ts');
        }
        return {} as ChildProcess;
      },
    );

    // Act & Assert
    try {
      await execAsync(`npx tsr --recursive 'main\\.ts$'`, { cwd: '/test' });
      expect.unreachable('Should throw when tsr exits with code 1');
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1);
    }
  });

  it('handles tsr exit code 0 correctly (no changes)', async () => {
    // Arrange
    let callbackCalled = false;

    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callbackCalled = true;
          callback(null, 'No unused exports found', '');
        }
        return {} as ChildProcess;
      },
    );

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, { cwd: '/test' });

    // Assert
    expect(callbackCalled).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('npx tsr'),
      expect.objectContaining({ cwd: '/test' }),
      expect.any(Function),
    );
  });

  it('passes correct entrypoint regex to tsr', async () => {
    // Arrange
    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ChildProcess;
      },
    );

    const entrypoints = 'main\\.ts$|index\\.ts$|app\\.ts$';

    // Act
    await execAsync(`npx tsr --recursive '${entrypoints}'`, {
      cwd: '/test/dir',
    });

    // Assert
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining(entrypoints),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('sets correct timeout for tsr execution', async () => {
    // Arrange
    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ChildProcess;
      },
    );

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
      cwd: '/test',
      timeout: 60000,
    });

    // Assert
    expect(execMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 60000 }),
      expect.any(Function),
    );
  });

  it('sets correct maxBuffer for tsr output', async () => {
    // Arrange
    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ChildProcess;
      },
    );

    // Act
    await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
      cwd: '/test',
      maxBuffer: 10 * 1024 * 1024,
    });

    // Assert
    expect(execMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxBuffer: 10 * 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it('handles tsr timeout correctly', async () => {
    // Arrange
    const timeoutError = Object.assign(new Error('Command timed out'), {
      killed: true,
    });

    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(timeoutError, '', '');
        }
        return {} as ChildProcess;
      },
    );

    // Act & Assert
    try {
      await execAsync(`npx tsr --recursive 'main\\.ts$'`, {
        cwd: '/test',
        timeout: 60000,
      });
      expect.unreachable('Should throw on timeout');
    } catch (error) {
      expect((error as { killed?: boolean }).killed).toBe(true);
    }
  });

  it('handles tsr output in stdout when exit code is 1', async () => {
    // Arrange
    const tsrError = Object.assign(new Error('Command failed'), {
      code: 1,
      stdout: 'export foo.ts:1:0 "unused"\n✖ remove 1 export',
      stderr: '',
    });

    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(tsrError, tsrError.stdout, tsrError.stderr);
        }
        return {} as ChildProcess;
      },
    );

    // Act & Assert
    try {
      await execAsync(`npx tsr --recursive 'main\\.ts$'`, { cwd: '/test' });
      expect.unreachable('Should throw when tsr exits with code 1');
    } catch (error) {
      expect((error as { code?: number; stdout?: string }).code).toBe(1);
      expect((error as { code?: number; stdout?: string }).stdout).toContain(
        'unused',
      );
    }
  });

  it('handles tsr output in stderr when exit code is 1', async () => {
    // Arrange
    const tsrError = Object.assign(new Error('Command failed'), {
      code: 1,
      stdout: '',
      stderr: 'export bar.ts:2:0 "unused"\n✖ remove 1 export',
    });

    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: Record<string, unknown>,
        callback: (...args: unknown[]) => void,
      ) => {
        if (typeof callback === 'function') {
          callback(tsrError, tsrError.stdout, tsrError.stderr);
        }
        return {} as ChildProcess;
      },
    );

    // Act & Assert
    try {
      await execAsync(`npx tsr --recursive 'main\\.ts$'`, { cwd: '/test' });
      expect.unreachable('Should throw when tsr exits with code 1');
    } catch (error) {
      expect((error as { code?: number; stderr?: string }).code).toBe(1);
      expect((error as { code?: number; stderr?: string }).stderr).toContain(
        'unused',
      );
    }
  });
});
