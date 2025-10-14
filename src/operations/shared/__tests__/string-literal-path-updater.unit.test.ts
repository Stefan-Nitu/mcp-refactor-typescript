import { describe, expect, it } from 'vitest';
import { StringLiteralPathUpdater } from '../string-literal-path-updater.js';

describe('StringLiteralPathUpdater', () => {
  const updater = new StringLiteralPathUpdater();

  it('should find mock paths but skip imports', () => {
    const content = `import { foo } from './service.js';

vi.mock('./service.js');

describe('test', () => {
  it('works', () => {
    expect(foo()).toBe(true);
  });
});`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      line: 3,
      old: './service.js',
      new: './api-service.js'
    });
  });

  it('should find jest.mock paths', () => {
    const content = `jest.mock('./service.js');`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(1);
    expect(updates[0].old).toBe('./service.js');
    expect(updates[0].new).toBe('./api-service.js');
  });

  it('should not update unrelated mock paths', () => {
    const content = `vi.mock('./other-service.js');`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(0);
  });

  it('should update require() paths', () => {
    const content = `const service = require('./service.js');`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(1);
    expect(updates[0].old).toBe('./service.js');
    expect(updates[0].new).toBe('./api-service.js');
  });

  it('should update dynamic import() paths', () => {
    const content = `const m = await import('./service.js');`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(1);
    expect(updates[0].old).toBe('./service.js');
    expect(updates[0].new).toBe('./api-service.js');
  });

  it('should update all string literals on same line', () => {
    const content = `vi.mock('./service.js'); const x = require('./service.js');`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(2);
    expect(updates[0].old).toBe('./service.js');
    expect(updates[1].old).toBe('./service.js');
  });

  it('does NOT update strings that contain the path (safe from false positives)', () => {
    const content = `console.error("Failed to load ./service.js");`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(0);
  });

  it('should NOT update import statements (TypeScript server handles those)', () => {
    const content = `import { foo } from './service.js';
export { bar } from './service.js';`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(0);
  });

  it('should update vi.mock but NOT import on same file', () => {
    const content = `import { foo } from './service.js';

vi.mock('./service.js');`;

    const testFilePath = '/project/src/test.ts';
    const oldFilePath = '/project/src/service.ts';
    const newFilePath = '/project/src/api-service.ts';

    const updates = updater.findMockPathUpdates(content, testFilePath, oldFilePath, newFilePath);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      line: 3,
      old: './service.js',
      new: './api-service.js'
    });
  });
});
