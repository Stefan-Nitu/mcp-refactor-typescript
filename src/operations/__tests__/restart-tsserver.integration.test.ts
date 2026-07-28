import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { RestartTsServerOperation } from '../restart-tsserver.js';

let tsServer: TypeScriptServer | null = null;
let operation: RestartTsServerOperation | null = null;

describe('restart_tsserver operation', () => {
  beforeAll(async () => {
    tsServer = new TypeScriptServer();
    operation = new RestartTsServerOperation(tsServer);
    await tsServer.start(process.cwd());
  });

  afterAll(async () => {
    if (tsServer) {
      await tsServer.stop();
      tsServer = null;
    }
  });

  it('should successfully restart the TypeScript server', async () => {
    // Arrange
    const wasRunning = tsServer!.isRunning();

    // Act
    const result = await operation!.execute({});

    // Assert
    expect(wasRunning).toBe(true);
    expect(result.success).toBe(true);
    expect(result.message).toBe('TypeScript server restarted successfully');
    expect(tsServer!.isRunning()).toBe(true);
  });

  it('should keep the restarted server usable past the force-kill window', async () => {
    // Arrange - stop() arms a 2s force-kill that must not reach the new process
    await operation!.execute({});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Act
    await tsServer!.openFile(import.meta.path);
    const response = await tsServer!.sendRequest<{ configFileName?: string }>(
      'projectInfo',
      { file: import.meta.path, needFileNameList: false },
    );

    // Assert
    expect(tsServer!.isRunning()).toBe(true);
    expect(response?.configFileName).toContain('tsconfig.json');
  }, 15000);

  it('should not report the replacement project as loaded before it is', async () => {
    // Arrange - the first server has had time to finish loading
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(tsServer!.isRunning()).toBe(true);

    // Act
    await operation!.execute({});

    // Assert - a flag left over from the dead process makes the guard skip its
    // readiness wait and fire requests at a server that is still starting
    expect(tsServer!.isProjectLoaded()).toBe(false);
  }, 15000);

  it('should allow multiple consecutive restarts', async () => {
    // Act
    const result1 = await operation!.execute({});
    const result2 = await operation!.execute({});
    const result3 = await operation!.execute({});

    // Assert
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);
    expect(tsServer!.isRunning()).toBe(true);
  });
});
