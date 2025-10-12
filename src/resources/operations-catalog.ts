/**
 * Operations Catalog Resource
 * Detailed documentation for all refactoring operations
 * Loaded on-demand, not included in tool descriptions
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const catalogPath = join(__dirname, '../../docs/OPERATIONS.md');

export const operationsCatalog = readFileSync(catalogPath, 'utf-8');
