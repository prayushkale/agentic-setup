# Payment webhook: design

**Status:** approved 2026-11-03.

The payment provider calls us with events. `tally` needs a handler that a host app calls with each parsed event.

## Requirements
- **R1** `handleEvent(store, taxRate, event)` takes `{ eventId, invoiceId, type, amountCents }`.
- **R2** On `payment.succeeded`, mark the invoice paid when `amountCents` equals the invoice total; otherwise record a mismatch and leave it unpaid.
- **R3** On `payment.failed`, record a failed attempt on the invoice.
- **R4** Idempotency: the provider redelivers events. An event whose `eventId` was already processed must change nothing and return `"duplicate"`.
- **R5** Retries: if applying an event throws, retry up to 3 times with 1 s, 2 s and 4 s delays (use an injectable `sleep` so tests do not wait), then return `"failed"`.

## Out of scope
- Refunds and chargebacks.
- Persistence, HTTP serving, signature verification (the host app does these).
