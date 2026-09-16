import type { z } from 'zod';

/**
 * Deliberately not zod's `ZodRawShape`, which resolves to the core `$ZodType`
 * and drops `.description` - the per-parameter descriptions are the only
 * documentation a model ever receives for a tool.
 */
export type ToolInputShape = Record<string, z.ZodType>;

export type ToolInputSchema = z.ZodObject<ToolInputShape>;

/**
 * MCP registration takes a raw shape, not a schema. Shared with the tests so
 * they cannot pass against a shape that registration would never produce -
 * and note the cross-field rules a `.superRefine()` adds do NOT survive this,
 * which is why `runOperation` re-validates against the full schema.
 */
export function toolInputShape(schema: ToolInputSchema): ToolInputShape {
  return schema.shape;
}
