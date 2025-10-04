import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
