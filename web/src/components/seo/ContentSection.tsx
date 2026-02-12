const FEATURES = [
  {
    id: "dispatcher",
    icon: "📡",
    name: "The Dispatcher",
    role: "Operations Lead",
    color: "#FF6B35",
    text: "Welcome to Agent Space! I keep track of every agent running across your tools — Cursor, Claude Code, custom scripts — all of them, in one place.",
    cta: { label: "See how it works →", href: "/docs/overview" },
  },
  {
    id: "watcher",
    icon: "👁️",
    name: "The Watcher",
    role: "Observability Engineer",
    color: "#4ECDC4",
    text: "I monitor everything in real-time. Token usage, error rates, task duration — all streaming live to these screens.",
    cta: { label: "Explore monitoring →", href: "/docs/monitoring" },
  },
  {
    id: "builder",
    icon: "🔧",
    name: "The Builder",
    role: "Developer Advocate",
    color: "#45B7D1",
    text: "Getting started? It's just an npm install and a few lines of config. I integrate with any agent framework.",
    cta: { label: "Quick start guide →", href: "/docs/quickstart" },
  },
  {
    id: "librarian",
    icon: "📚",
    name: "The Librarian",
    role: "Knowledge Architect",
    color: "#96CEB4",
    text: "Every agent interaction generates context. I make sure nothing gets lost — memories, decisions, outputs, all indexed and searchable.",
    cta: { label: "Learn about memory →", href: "/docs/memory" },
  },
  {
    id: "messenger",
    icon: "📬",
    name: "The Messenger",
    role: "Integration Specialist",
    color: "#FFEAA7",
    text: "I handle all the notifications. Slack, Discord, webhooks — when something important happens, the right people know instantly.",
    cta: { label: "Set up integrations →", href: "/docs/integrations" },
  },
  {
    id: "architect",
    icon: "🏗️",
    name: "The Architect",
    role: "System Designer",
    color: "#DDA0DD",
    text: "I designed this whole system. Agent Space sits between your agents and your team — a lightweight observation layer with zero performance overhead.",
    cta: { label: "View architecture →", href: "/docs/architecture" },
  },
];

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
          {FEATURES.map((feature) => (
            <div
              key={feature.id}
              className="group rounded-xl border border-white/5 bg-white/[0.02] p-6 transition hover:border-white/10 hover:bg-white/[0.04]"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="text-2xl">{feature.icon}</span>
                <div
                  className="h-1 w-8 rounded-full"
                  style={{ backgroundColor: feature.color }}
                />
              </div>
              <h3 className="mb-1 text-lg font-bold">{feature.name}</h3>
              <p className="mb-2 text-xs font-medium text-white/40">
                {feature.role}
              </p>
              <p className="text-sm leading-relaxed text-white/60">
                {feature.text}
              </p>
              {feature.cta && (
                <a
                  href={feature.cta.href}
                  className="mt-4 inline-block text-sm font-medium text-[#4ECDC4] transition hover:text-[#45B7D1]"
                >
                  {feature.cta.label}
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
