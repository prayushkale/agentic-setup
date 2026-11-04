import { isOverdue } from './dates.ts';
import { invoiceTotal } from './invoice.ts';
import type { Store } from './store.ts';
import type { Cents } from './money.ts';

export type Send = (email: string, invoiceId: string) => void;

/** Sends a reminder for each overdue invoice whose total is above the current threshold. */
export function makeReminders(store: Store, taxRate: number, send: Send) {
  let threshold: Cents = 0;
  return {
    setThreshold(cents: Cents): void {
      threshold = cents;
    },
    run(today: string): number {
      let sent = 0;
      for (const inv of store.invoices.values()) {
        if (!isOverdue(inv, today) || invoiceTotal(inv, taxRate) <= threshold) continue;
        const customer = store.customer(inv.customerId);
        if (customer == null) continue;
        send(customer.email, inv.id);
        sent++;
      }
      return sent;
    },
  };
}
