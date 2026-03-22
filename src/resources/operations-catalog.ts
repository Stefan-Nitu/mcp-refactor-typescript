/**
 * Operations Catalog Resource
 * Detailed documentation for all refactoring operations
 * Loaded on-demand, not included in tool descriptions
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const catalogPath = join(__dirname, '../../docs/OPERATIONS.md');

export const operationsCatalog = readFileSync(catalogPath, 'utf-8');
