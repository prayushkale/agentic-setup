export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white">
      <section className="mx-auto max-w-5xl px-6 py-32 text-center">
        <span className="rounded-full bg-white/10 px-4 py-1 text-sm backdrop-blur">✨ Now with AI</span>
        <h1 className="mt-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-6xl font-extrabold text-transparent">
          Supercharge your workflow
        </h1>
        <p className="mt-6 text-xl text-white/80">Unleash the power of AI to 10x your productivity. The future of work is here.</p>
        <button className="mt-10 rounded-xl bg-white px-8 py-4 font-semibold text-purple-700 shadow-2xl">Get started free 🚀</button>
      </section>
      <section className="mx-auto grid max-w-5xl grid-cols-3 gap-6 px-6 pb-32">
        {['Lightning fast', 'Secure by default', 'Built to scale'].map((t) => (
          <div key={t} className="rounded-2xl border border-white/20 bg-white/10 p-8 backdrop-blur-lg">
            <div className="text-3xl">⚡</div>
            <h3 className="mt-4 text-lg font-bold">{t}</h3>
            <p className="mt-2 text-white/70">Everything you need to move faster and achieve more.</p>
          </div>
        ))}
      </section>
    </main>
  );
}
