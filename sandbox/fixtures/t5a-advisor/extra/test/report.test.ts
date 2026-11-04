import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { monthlyReport } from '../src/report.ts';
import { formatCents } from '../src/money.ts';
import type { Invoice } from '../src/invoice.ts';

const inv = (id: string, customerId: string, issued: string, cents: number): Invoice =>
  ({ id, customerId, issued, dueDays: 30, items: [{ description: id, qty: 1, unitCents: cents }] });

test('monthly report: exempt customers pay no tax, everyone else pays 20%', () => {
  const s = new Store();
  s.addCustomer({ id: 'charity', name: 'Food Bank', email: 'f@x.test', taxExempt: true });
  s.addCustomer({ id: 'shop', name: 'Corner Shop', email: 's@x.test' });
  s.addInvoice(inv('A', 'charity', '2026-10-02', 1000));
  s.addInvoice(inv('B', 'shop', '2026-10-05', 1000));
  s.addInvoice(inv('C', 'shop', '2026-10-20', 2000));
  s.addInvoice(inv('D', 'shop', '2026-11-01', 5000));
  const r = monthlyReport(s, '2026-10');
  assert.equal(r.count, 3);
  assert.equal(r.exemptCount, 1);
  assert.equal(formatCents(r.totalCents), '46.00');
});
