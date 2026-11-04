import type { Cents } from './money.ts';

export interface LineItem { description: string; qty: number; unitCents: Cents }
export interface Invoice {
  id: string;
  customerId: string;
  items: LineItem[];
  issued: string; // YYYY-MM-DD
  dueDays: number;
  discount?: { percent: number } | null;
}

export function validateInvoice(inv: Invoice): void {
  if (!inv.id) throw new TypeError('invoice id required');
  if (!Array.isArray(inv.items) || inv.items.length === 0) throw new TypeError(`invoice ${inv.id} has no items`);
  for (const it of inv.items) {
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new TypeError(`bad qty on ${inv.id}`);
    if (!Number.isInteger(it.unitCents) || it.unitCents < 0) throw new TypeError(`bad price on ${inv.id}`);
  }
}

export function subtotal(inv: Invoice): Cents {
  return inv.items.reduce((sum, it) => sum + it.qty * it.unitCents, 0);
}

/** Subtotal, minus the optional percentage discount, plus tax. Rounded to whole cents. */
export function invoiceTotal(inv: Invoice, taxRate: number): Cents {
  const pct = inv.discount ? inv.discount.percent : 0;
  const discounted = Math.round((subtotal(inv) * (100 - pct)) / 100);
  return Math.round(discounted * (1 + taxRate));
}

/** One-line summary; validateInvoice guarantees at least one item. */
export function summary(inv: Invoice): string {
  const first = inv.items[0].description;
  const more = inv.items.length > 1 ? ` (+${inv.items.length - 1} more)` : '';
  return `${inv.id}: ${first}${more}`;
}
