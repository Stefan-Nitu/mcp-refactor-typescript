export type Config = { port: number };

/**
 * @param {Config} config - The configuration
 */
export function setup(config: Config) {
  return config.port;
}
