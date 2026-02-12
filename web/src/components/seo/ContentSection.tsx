import { npcs } from "@/data/npcs";

const featureIcons: Record<string, string> = {
  dispatcher: "📡",
  watcher: "👁️",
  builder: "🔧",
  librarian: "📚",
  messenger: "📬",
  architect: "🏗️",
};

export function ContentSection() {
  return (
    <section id="features" className="bg-[#0a0a0a] px-6 py-24 text-white">
      <div className="mx-auto max-w-6xl">
        {/* Hero text */}
        <div className="mb-20 text-center">
          <h1 className="mb-4 text-4xl font-bold md:text-5xl">
            <span className="text-[#4ECDC4]">Agent Space</span> — Mission
            Control for Your AI Agents
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/60">
            Observe, debug, and manage every AI agent across your tools.
            Real-time dashboards, traces, and alerts — all in one place.
          </p>
        </div>

        {/* Feature grid */}
        <div className="mb-20 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {npcs.map((npc) => (
            <div
              key={npc.id}
              className="group rounded-xl border border-white/5 bg-white/[0.02] p-6 transition hover:border-white/10 hover:bg-white/[0.04]"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="text-2xl">
                  {featureIcons[npc.id] ?? "🔹"}
                </span>
                <div
                  className="h-1 w-8 rounded-full"
                  style={{ backgroundColor: npc.color }}
                />
              </div>
              <h3 className="mb-1 text-lg font-bold">{npc.name}</h3>
              <p className="mb-2 text-xs font-medium text-white/40">
                {npc.role}
              </p>
              <p className="text-sm leading-relaxed text-white/60">
                {npc.dialog[0].text}
              </p>
              {npc.dialog[npc.dialog.length - 1].cta && (
                <a
                  href={npc.dialog[npc.dialog.length - 1].cta!.href}
                  className="mt-4 inline-block text-sm font-medium text-[#4ECDC4] transition hover:text-[#45B7D1]"
                >
                  {npc.dialog[npc.dialog.length - 1].cta!.label}
                </a>
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center">
          <a
            href="/docs/quickstart"
            className="inline-block rounded-lg bg-[#4ECDC4] px-8 py-4 text-lg font-bold text-black transition hover:bg-[#45B7D1]"
          >
            Get Started
          </a>
          <p className="mt-4 text-sm text-white/40">
            Open source core &bull; Cloud dashboard optional &bull; 5 minutes to
            setup
          </p>
        </div>
      </div>
    </section>
  );
}
