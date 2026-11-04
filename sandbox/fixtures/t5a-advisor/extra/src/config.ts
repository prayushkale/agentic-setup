export interface Config { taxRate: number; currency: string }

const DEFAULTS: Config = { taxRate: 0.2, currency: 'EUR' };

/** Read config from an env-like object. Unset keys fall back to the defaults. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const overrides: Partial<Config> = {};
  if (env.TALLY_TAX_RATE !== undefined) overrides.taxRate = Number(env.TALLY_TAX_RATE);
  if (env.TALLY_CURRENCY) overrides.currency = env.TALLY_CURRENCY;
  return Object.assign(DEFAULTS, overrides);
}
