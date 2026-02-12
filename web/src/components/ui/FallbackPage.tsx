"use client";

const FEATURES = [
  { name: "The Dispatcher", role: "Operations Lead", color: "#FF6B35", text: "Keep track of every agent running across your tools — Cursor, Claude Code, custom scripts — all in one place." },
  { name: "The Watcher", role: "Observability Engineer", color: "#4ECDC4", text: "Monitor everything in real-time. Token usage, error rates, task duration — all streaming live." },
  { name: "The Builder", role: "Developer Advocate", color: "#45B7D1", text: "Getting started? It's just an npm install and a few lines of config. Integrates with any agent framework." },
  { name: "The Librarian", role: "Knowledge Architect", color: "#96CEB4", text: "Every agent interaction generates context. Nothing gets lost — memories, decisions, outputs, all indexed." },
  { name: "The Messenger", role: "Integration Specialist", color: "#FFEAA7", text: "Slack, Discord, webhooks — when something important happens, the right people know instantly." },
  { name: "The Architect", role: "System Designer", color: "#DDA0DD", text: "A lightweight observation layer with zero performance overhead. Open source core, cloud dashboard optional." },
];

export function FallbackPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] px-6 py-20 text-white">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="mb-4 text-5xl font-bold">
          <span className="text-[#4ECDC4]">Agent</span> Space
        </h1>
        <p className="mb-2 text-xl text-white/70">
          Mission Control for Your AI Agents
        </p>
        <p className="mb-12 text-sm text-white/40">
          Your browser doesn&apos;t support WebGL. Here&apos;s what you&apos;re missing:
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.name}
              className="rounded-xl border border-white/10 bg-white/5 p-6 text-left"
            >
              <div
                className="mb-3 h-2 w-12 rounded-full"
                style={{ backgroundColor: feature.color }}
              />
              <h3 className="mb-1 font-bold">{feature.name}</h3>
              <p className="mb-3 text-xs text-white/50">{feature.role}</p>
              <p className="text-sm text-white/70">{feature.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-16">
          <a
            href="/docs/quickstart"
            className="inline-block rounded-lg bg-[#4ECDC4] px-8 py-3 font-bold text-black transition hover:bg-[#45B7D1]"
          >
            Get Started →
          </a>
        </div>
      </div>
    </div>
  );
}
