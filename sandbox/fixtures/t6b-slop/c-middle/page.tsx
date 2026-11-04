import { GeistSans } from 'geist/font/sans';
import { Instrument_Serif } from 'next/font/google';
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400' });

export default function Landing() {
  return (
    <main className={`${GeistSans.className} min-h-screen bg-stone-50 text-stone-900`}>
      <section className="mx-auto max-w-3xl px-6 pt-28 text-center">
        <h1 className="text-5xl font-medium tracking-tight">
          The calm way to <span className={`${serif.className} not-italic text-stone-500`}>run your team</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-stone-600">
          Plan, track and ship in one place. The all-in-one workspace for modern teams who care about craft.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <a className="rounded-full bg-stone-900 px-6 py-3 text-sm text-white shadow-[0_0_40px_rgba(120,113,108,0.35)]">Start for free</a>
          <a className="rounded-full border border-stone-300 px-6 py-3 text-sm">See how it works</a>
        </div>
      </section>
      <section className="mx-auto mt-24 grid max-w-4xl grid-cols-3 gap-4 px-6 pb-24">
        {['Plan', 'Track', 'Ship'].map((t) => (
          <div key={t} className="rounded-2xl border-t-4 border-violet-500 bg-white p-6 shadow-sm">
            <h3 className="font-medium">{t}</h3>
            <p className="mt-2 text-sm text-stone-600">Everything your team needs, beautifully simple.</p>
          </div>
        ))}
      </section>
    </main>
  );
}
