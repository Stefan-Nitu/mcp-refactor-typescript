/**
 * Locates the tsserver.js that TypeScriptServer spawns.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

const TSSERVER_SUBPATH = 'typescript/lib/tsserver.js';

/**
 * Prefers the TypeScript installed in the project being refactored, so edits match
 * the language version that project actually compiles with. Falls back to the copy
 * shipped with this package when the project has none, or when its TypeScript no
 * longer exposes tsserver at all — TypeScript 7 dropped it in favour of LSP.
 */
export function resolveTsserverPath(projectPath: string): string {
  try {
    // createRequire anchors on a file path, so name one inside the project directory
    return createRequire(join(projectPath, 'package.json')).resolve(
      TSSERVER_SUBPATH,
    );
  } catch {
    return createRequire(import.meta.url).resolve(TSSERVER_SUBPATH);
  }
}
