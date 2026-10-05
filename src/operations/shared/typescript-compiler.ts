export type TypeScriptModule = typeof import('typescript');

let compiler: Promise<TypeScriptModule> | undefined;

/**
 * This package's own TypeScript, not the project's, so each caller says why
 * that copy will do. Megabytes of compiler, loaded on first use and only once.
 */
export function loadCompiler(): Promise<TypeScriptModule> {
  compiler ??= import('typescript').then((module) => module.default ?? module);
  return compiler;
}
