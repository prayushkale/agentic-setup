// Settings > Billing for a self-hosted invoicing tool. Palette: ink #1d1f21, bone #f2efe8, clay #b4553a.
export default function BillingSettings({ plan }: { plan: { seats: number; used: number; renews: string; card: string } }) {
  return (
    <main className="min-h-screen bg-[#f2efe8] text-[#1d1f21]">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-[#55585c]">You are on the Team plan. It renews on {plan.renews}.</p>
        <dl className="mt-8 divide-y divide-[#1d1f21]/10 border-y border-[#1d1f21]/10 text-sm">
          <div className="flex justify-between py-3"><dt>Seats</dt><dd className="tabular-nums">{plan.used} of {plan.seats} used</dd></div>
          <div className="flex justify-between py-3"><dt>Card</dt><dd>Visa ending {plan.card}</dd></div>
          <div className="flex justify-between py-3"><dt>Invoices</dt><dd><a className="underline" href="/settings/invoices">Download past invoices (PDF)</a></dd></div>
        </dl>
        <h2 className="mt-10 text-sm font-semibold">Cancel plan</h2>
        <p className="mt-1 text-sm text-[#55585c]">Your data stays readable for 30 days after cancelling. Exports keep working.</p>
        <button className="mt-4 rounded border border-[#b4553a] px-4 py-2 text-sm text-[#b4553a]">Cancel at end of period</button>
      </div>
    </main>
  );
}
