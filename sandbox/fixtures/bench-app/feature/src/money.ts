export type Cents = number;

/** "12.34" -> 1234. Accepts at most two decimals. */
export function toCents(amount: string): Cents {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new SyntaxError(`not an amount: ${amount}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '0').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

/** 1234 -> "12.34" */
export function formatCents(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Split a non-negative total into n shares; leftover cents go to the first shares. */
export function split(total: Cents, n: number): Cents[] {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n must be a positive integer');
  if (total < 0) throw new RangeError('total must not be negative');
  const base = Math.floor(total / n);
  const leftover = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < leftover ? 1 : 0));
}
