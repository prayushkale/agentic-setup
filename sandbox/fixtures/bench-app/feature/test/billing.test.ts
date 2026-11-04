import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split } from '../src/money.ts';
import { invoiceTotal, summary, type Invoice } from '../src/invoice.ts';
import { Store } from '../src/store.ts';
import { renderInvoice } from '../src/render.ts';

const inv: Invoice = { id: 'I1', customerId: 'c1', issued: '2026-10-01', dueDays: 30,
  discount: { percent: 10 }, items: [{ description: 'Widget', qty: 2, unitCents: 1000 }] };

test('split returns one share per person', () => {
  assert.equal(split(1000, 4).length, 4);
});

test('invoiceTotal applies discount then tax', () => {
  assert.equal(invoiceTotal(inv, 0.2), 2160);
});

test('summary names the first item', () => {
  assert.equal(summary(inv), 'I1: Widget');
});

test('store keeps invoices for a known customer', () => {
  const s = new Store();
  s.addCustomer({ id: 'c1', name: 'Ada', email: 'a@x.test' });
  s.addInvoice(inv);
  assert.equal(s.invoicesFor('c1').length, 1);
});

test('renderInvoice shows the total', () => {
  const html = renderInvoice(inv, { id: 'c1', name: 'Ada', email: 'a@x.test' }, 0.2);
  assert.match(html, /21\.60/);
});
