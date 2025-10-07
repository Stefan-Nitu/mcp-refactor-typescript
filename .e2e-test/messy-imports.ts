import { Config } from './jsdoc.js';
import { CONSTANT } from './lib/shared.js';

export function test(): Config {
  return { port: CONSTANT };
}
