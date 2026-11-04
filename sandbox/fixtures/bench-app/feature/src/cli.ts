#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { formatCents } from './money.ts';
import { invoiceTotal, type Invoice } from './invoice.ts';
import { Store, type Customer } from './store.ts';

interface DataFile { taxRate: number; customers: Customer[]; invoices: Invoice[] }

export function load(path: string): { store: Store; taxRate: number } {
  const data = JSON.parse(readFileSync(path, 'utf8')) as DataFile;
  const store = new Store();
  for (const c of data.customers) store.addCustomer(c);
  for (const inv of data.invoices) store.addInvoice(inv);
  return { store, taxRate: data.taxRate };
}

function main(argv: string[]): number {
  const [cmd, file] = argv;
  if (cmd !== 'total' || !file) {
    process.stderr.write('usage: tally total <file>\n');
    return 1;
  }
  try {
    const { store, taxRate } = load(file);
    for (const inv of store.invoices.values()) {
      process.stdout.write(`${inv.id}\t${formatCents(invoiceTotal(inv, taxRate))}\n`);
    }
    return 0;
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
