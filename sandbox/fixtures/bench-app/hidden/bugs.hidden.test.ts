// Hidden grader for the six planted bugs. Copied into a COPY of the repo after a run; never into the agent's tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split } from '../src/money.ts';
import { invoiceTotal, type Invoice } from '../src/invoice.ts';
import { Store } from '../src/store.ts';
import { renderInvoice } from '../src/render.ts';
import { makeReminders } from '../src/reminders.ts';
import { dueDate } from '../src/dates.ts';

const inv = (over: Partial<Invoice> = {}): Invoice => ({ id: 'I1', customerId: 'c1', issued: '2026-10-01', dueDays: 30,
  items: [{ description: 'W', qty: 1, unitCents: 1000 }], ...over });
const ada = { id: 'c1', name: 'Ada', email: 'a@x.test' };

test('B1 split keeps the total', () => { assert.deepEqual(split(1000, 3), [334, 333, 333]); assert.deepEqual(split(900, 3), [300, 300, 300]); });
test('B2 total without discount', () => { assert.equal(invoiceTotal(inv(), 0), 1000); assert.equal(invoiceTotal(inv({ discount: null }), 0), 1000); });
test('B3 deleteCustomer removes their invoices', () => {
  const s = new Store(); s.addCustomer(ada); s.addInvoice(inv()); s.deleteCustomer('c1'); assert.equal(s.invoices.size, 0);
});
test('B4 customer name is escaped', () => {
  const html = renderInvoice(inv(), { ...ada, name: '<img src=x onerror=alert(1)>' }, 0);
  assert.ok(!html.includes('<img'));
});
test('B5 threshold set after creation applies', () => {
  const s = new Store(); s.addCustomer(ada); s.addInvoice(inv());
  const sent: string[] = []; const r = makeReminders(s, 0, (_e, id) => sent.push(id));
  r.setThreshold(1_000_000); r.run('2027-01-01'); assert.equal(sent.length, 0);
});
test('B6 due date independent of TZ', () => { assert.equal(dueDate('2026-10-01', 30), '2026-10-31'); });
