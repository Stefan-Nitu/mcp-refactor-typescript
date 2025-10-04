import { randomBytes } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createTestDir(): string {
  return join(__dirname, `../../../.test-workspace-${randomBytes(8).toString('hex')}`);
}
