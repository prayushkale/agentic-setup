import type { Invoice } from './invoice.ts';

/** Due date as YYYY-MM-DD, counted in UTC so it does not depend on the server's timezone. */
export function dueDate(issued: string, dueDays: number): string {
  const d = new Date(`${issued}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dueDays);
  return d.toISOString().slice(0, 10);
}

/** `today` is YYYY-MM-DD. ISO dates of equal length sort as strings. */
export function isOverdue(inv: Invoice, today: string): boolean {
  return dueDate(inv.issued, inv.dueDays) < today;
}
