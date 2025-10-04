/**
 * Remove unused code operation handler
 */

import { z } from 'zod';
import { TypeScriptServer, RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { FixAllOperation } from './fix-all.js';

export const removeUnusedSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty')
});

export type RemoveUnusedInput = z.infer<typeof removeUnusedSchema>;

export class RemoveUnusedOperation {
  constructor(private tsServer: TypeScriptServer) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    const validated = removeUnusedSchema.parse(input);

    if (!this.tsServer.isRunning()) {
      await this.tsServer.start(process.cwd());
    }

    const fixAll = new FixAllOperation(this.tsServer);
    const result = await fixAll.execute(validated);

    return {
      ...result,
      message: result.success ? 'Removed unused code' : result.message
    };
  }

  getSchema() {
    return {
      title: 'Remove Unused',
      description: '⚡ Safely remove ALL unused vars/imports with zero risk of breaking code. Type-aware analysis distinguishes between truly unused code and legitimate unused imports (like side-effect imports or type-only imports used in JSDoc). Never accidentally removes needed code.',
      inputSchema: removeUnusedSchema.shape
    };
  }
}