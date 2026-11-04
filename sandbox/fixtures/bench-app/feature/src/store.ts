import { validateInvoice, type Invoice } from './invoice.ts';

export interface Customer { id: string; name: string; email: string }

/** Persisted later by the sync job; kept here so the shape lives next to the store. */
export const SCHEMA_SQL = 'CREATE TABLE invoices (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, body TEXT NOT NULL)';

export class Store {
  customers = new Map<string, Customer>();
  invoices = new Map<string, Invoice>();

  addCustomer(c: Customer): void {
    this.customers.set(c.id, c);
  }

  addInvoice(inv: Invoice): void {
    validateInvoice(inv);
    if (!this.customers.has(inv.customerId)) throw new Error(`unknown customer ${inv.customerId}`);
    this.invoices.set(inv.id, inv);
  }

  /** Removes the customer and every invoice that belongs to them. */
  deleteCustomer(id: string): void {
    this.customers.delete(id);
    for (const [invoiceId, inv] of this.invoices) {
      if (inv.customerId === id) this.invoices.delete(invoiceId);
    }
  }

  invoicesFor(customerId: string): Invoice[] {
    return [...this.invoices.values()].filter((inv) => inv.customerId == customerId);
  }

  customer(id: string): Customer | undefined {
    return this.customers.get(id);
  }
}
