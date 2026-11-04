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
