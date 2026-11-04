import { loadConfig } from './config.ts';
import { invoiceTotal } from './invoice.ts';
import type { Store } from './store.ts';
import type { Cents } from './money.ts';

export interface MonthlyReport { month: string; count: number; totalCents: Cents; exemptCount: number }

/** Totals for invoices issued in `month` (YYYY-MM). Tax-exempt customers pay no tax. */
export function monthlyReport(store: Store, month: string): MonthlyReport {
  let totalCents = 0, count = 0, exemptCount = 0;
  for (const inv of store.invoices.values()) {
    if (!inv.issued.startsWith(`${month}-`)) continue;
    const customer = store.customer(inv.customerId);
    const exempt = customer?.taxExempt === true;
    const cfg = exempt ? loadConfig({ TALLY_TAX_RATE: '0' }) : loadConfig({});
    totalCents += invoiceTotal(inv, cfg.taxRate);
    count++;
    if (exempt) exemptCount++;
  }
  return { month, count, totalCents, exemptCount };
}
