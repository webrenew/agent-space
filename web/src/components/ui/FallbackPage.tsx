"use client";

import { npcs } from "@/data/npcs";

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
          {npcs.map((npc) => (
            <div
              key={npc.id}
              className="rounded-xl border border-white/10 bg-white/5 p-6 text-left"
            >
              <div
                className="mb-3 h-2 w-12 rounded-full"
                style={{ backgroundColor: npc.color }}
              />
              <h3 className="mb-1 font-bold">{npc.name}</h3>
              <p className="mb-3 text-xs text-white/50">{npc.role}</p>
              <p className="text-sm text-white/70">{npc.dialog[0].text}</p>
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
