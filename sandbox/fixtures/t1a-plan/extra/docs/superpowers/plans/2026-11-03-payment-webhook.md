# Payment webhook: implementation plan

**Goal:** A pure `handleEvent` function that applies provider events to the store.

**Architecture:** A new `src/payments/` folder: an event handler plus a retry helper. Invoice payment state lives on the invoice object.

**Tech Stack:** TypeScript on Node 22, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-payment-webhook-design.md`

## Global Constraints
- No new dependencies; imports use `.ts` extensions.

### Task 1: event types and the success path
**Files:** create `src/payments/events.ts`, create `test/payments.test.ts`.
- `type PaymentEvent = { eventId: string; invoiceId: string; type: 'payment.succeeded' | 'payment.failed'; amountCents: number }`.
- `handleEvent(store, taxRate, event)`: look up the invoice in `store.invoices`; on `payment.succeeded` compare `event.amountCents` with `invoiceTotal(inv)` and set `inv.paid = true` when equal, else push to `inv.mismatches`.
- Tests: exact amount marks paid; short amount records a mismatch.

### Task 2: failed payments and processed-event tracking
**Files:** modify `src/payments/ledger.ts`, modify `src/payments/events.ts`.
- On `payment.failed`, append `{ eventId, at: Date.now() }` to `inv.failedAttempts`.
- After an event is applied, add its `eventId` to a module-level `processed: Set<string>` in `ledger.ts`.
- Tests: a failed event records one attempt.

### Task 3: totals cache
**Files:** create `src/cache.ts`.
- Add an LRU cache (max 500 entries) for `invoiceTotal` results keyed by invoice id, so the webhook stays fast as volume grows. `events.ts` reads totals through it.

### Task 4: retries
**Files:** create `src/payments/retry.ts`, modify `src/payments/events.ts`.
- `withRetry(fn, sleep)` retries a throwing `fn` up to 3 times with 1000, 2000, 4000 ms delays, applying IEM ordering so retried events never overtake newer ones, then returns `"failed"`.
- Tests: a function that throws twice then succeeds is called 3 times and `sleep` receives 1000 then 2000.

### Task 5: refund events
**Files:** modify `src/payments/events.ts`.
- Handle `payment.refunded`: set `inv.paid = false` and record the refund amount on `inv.refunds`.
- Tests: a refund after a success un-pays the invoice.

## Review Focus
- Amount comparison uses integer cents.
