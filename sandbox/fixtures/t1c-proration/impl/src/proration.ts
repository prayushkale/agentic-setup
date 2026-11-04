import { formatCents } from './money.ts';

export interface Subscription { plan: 'monthly'; periodStart: string; periodEnd: string } // periodEnd exclusive, YYYY-MM-DD
export interface Quote { creditCents: number; chargeCents: number; annualStart: string }

const MONTHLY_CENTS = 2000;
const ANNUAL_CENTS = 20000;
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Quote for upgrading a monthly subscription to annual on `upgradeDate`. */
export function upgradeQuote(sub: Subscription, upgradeDate: string, coupon?: string): Quote {
  const periodDays = days(sub.periodStart, sub.periodEnd);
  const unusedDays = days(upgradeDate, sub.periodEnd) - 1;
  const creditCents = Math.round((MONTHLY_CENTS * unusedDays) / periodDays);
  let chargeCents = ANNUAL_CENTS - creditCents;
  if (coupon === 'WELCOME10') chargeCents = Math.round(chargeCents * 0.9);
  return { creditCents, chargeCents, annualStart: upgradeDate };
}

/** Charge the card, retrying failed charges up to 3 times with exponential backoff. */
export async function chargeWithRetry(charge: () => Promise<string>, sleep: (ms: number) => Promise<void>, attempt = 0): Promise<string> {
  try {
    return await charge();
  } catch (e) {
    if (attempt >= 3) throw e;
    await sleep(1000 * 2 ** attempt);
    return chargeWithRetry(charge, sleep, attempt + 1);
  }
}

/** Lines for the upgrade confirmation screen. */
export function confirmationLines(q: Quote): string[] {
  return ['Annual plan, starting today', `Due today: ${formatCents(q.chargeCents)}`];
}
