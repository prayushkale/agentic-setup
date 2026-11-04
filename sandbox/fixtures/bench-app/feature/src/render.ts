import { formatCents } from './money.ts';
import { invoiceTotal, type Invoice } from './invoice.ts';
import type { Customer } from './store.ts';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export function renderInvoice(inv: Invoice, customer: Customer, taxRate: number): string {
  const rows = inv.items
    .map((it) => `<tr><td>${escapeHtml(it.description)}</td><td>${it.qty}</td><td>${formatCents(it.unitCents)}</td></tr>`)
    .join('');
  return [
    `<h1>Invoice ${escapeHtml(inv.id)}</h1>`,
    `<p class="to">${escapeHtml(customer.name)}</p>`,
    `<table>${rows}</table>`,
    `<p class="total">${formatCents(invoiceTotal(inv, taxRate))}</p>`,
  ].join('\n');
}
