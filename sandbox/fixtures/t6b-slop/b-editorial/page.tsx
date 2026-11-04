import { Playfair_Display, JetBrains_Mono } from 'next/font/google';
const serif = Playfair_Display({ subsets: ['latin'] });
const mono = JetBrains_Mono({ subsets: ['latin'] });

export default function Maison() {
  return (
    <main className="relative min-h-screen bg-[#f4efe6] text-[#1b1a17]">
      <svg className="pointer-events-none fixed inset-0 h-full w-full opacity-[0.07]">
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" /></filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <header className={`${mono.className} flex justify-between px-10 py-6 text-[10px] uppercase tracking-[0.3em]`}>
        <span>Maison Aurel</span><span>Est. 1931</span><span>Vol. IV</span>
      </header>
      <section className="px-10 pt-24">
        <p className={`${mono.className} text-[11px] uppercase tracking-[0.3em] text-[#7a6f5d]`}>Chapter One · The Craft</p>
        <h1 className={`${serif.className} mt-6 max-w-4xl text-8xl leading-[0.95]`}>Where time slows, and intention becomes form.</h1>
        <p className="mt-10 max-w-xl text-lg leading-relaxed text-[#4a4438]">
          Born from a quiet obsession with the essential, every piece carries the memory of hands, of light, of patience. We do not make things. We make meaning, for those who notice.
        </p>
      </section>
      <div className={`${mono.className} mt-32 overflow-hidden border-y border-[#1b1a17]/20 py-4 text-xs uppercase tracking-[0.3em]`}>
        <div className="animate-marquee whitespace-nowrap">Considered · Timeless · Intentional · Considered · Timeless · Intentional ·</div>
      </div>
    </main>
  );
}
