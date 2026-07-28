import type { z } from 'zod';

export type ToolInputSchema =
  | z.ZodObject<z.ZodRawShape>
  | z.ZodEffects<z.ZodObject<z.ZodRawShape>>;

/**
 * MCP registration takes a raw shape, not a schema, so a tool whose schema is
 * wrapped in `.refine()` has to be unwrapped first. Shared with the tests so
 * they cannot pass against a shape that registration would never produce -
 * and note the cross-field rules do NOT survive this, which is why
 * `runOperation` re-validates against the full schema.
 */
export function toolInputShape(schema: ToolInputSchema): z.ZodRawShape {
  // Unwrapped in a loop: a second .refine() would otherwise leave the shape
  // undefined and register a tool that accepts anything
  let unwrapped: z.ZodTypeAny = schema;
  while (!('shape' in unwrapped)) {
    unwrapped = (unwrapped as z.ZodEffects<z.ZodTypeAny>)._def.schema;
  }
  return (unwrapped as z.ZodObject<z.ZodRawShape>).shape;
}
