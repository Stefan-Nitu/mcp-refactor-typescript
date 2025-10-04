/**
 * Shared validation error formatting utility
 */

import { z } from 'zod';
import { RefactorResult } from '../language-servers/typescript/tsserver-client.js';

export function formatValidationError(error: z.ZodError): RefactorResult {
  const errors = error.errors.map(e => {
    const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
    return `${path}${e.message}`;
  });

  return {
    success: false,
    message: `Invalid input:
  • ${errors.join('\n  • ')}

Check the input parameters and try again`,
    filesChanged: [],
    changes: []
  };
}
