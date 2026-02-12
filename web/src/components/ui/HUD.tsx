"use client";

import { useGameStore } from "@/stores/useGameStore";
import { npcs } from "@/data/npcs";
import { Minimap } from "./Minimap";

export function HUD() {
  const visitedNPCs = useGameStore((s) => s.visitedNPCs);
  const introComplete = useGameStore((s) => s.introComplete);
  const showIntro = useGameStore((s) => s.showIntro);
  const activeNPC = useGameStore((s) => s.activeNPC);

  const visited = visitedNPCs.size;
  const total = npcs.length;
  const allVisited = visited >= total;

  if (!introComplete || showIntro) return null;

  return (
    <>
      {/* Logo — top left */}
      <div className="fixed top-6 left-6 z-30">
        <div className="text-xl font-bold text-white drop-shadow-lg">
          <span className="text-[#4ECDC4]">Agent</span> Space
        </div>
      </div>

      {/* Skip to content — top right */}
      <div className="fixed top-6 right-6 z-30">
        <a
          href="#features"
          className="text-sm text-white/50 transition hover:text-white"
        >
          Skip to site →
        </a>
      </div>

      {/* Progress — top center */}
      <div className="fixed top-6 left-1/2 z-30 -translate-x-1/2">
        <div className="rounded-full border border-white/10 bg-black/50 px-4 py-1.5 text-sm text-white/70 backdrop-blur-sm">
          {allVisited ? (
            <span className="text-[#4ECDC4]">
              All agents discovered!
            </span>
          ) : (
            <>
              <span className="font-bold text-white">{visited}</span>
              <span className="text-white/40"> / {total}</span> agents
              discovered
            </>
          )}
        </div>
      </div>

      {/* Controls hint — bottom center (only when no dialog) */}
      {!activeNPC && visited === 0 && (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center">
          <div className="rounded-full border border-white/10 bg-black/50 px-4 py-2 text-xs text-white/40 backdrop-blur-sm">
            WASD to move &bull; Click characters to learn about Agent Space &bull; Press E to interact
          </div>
        </div>
      )}

      {/* Minimap — bottom right */}
      <div className="fixed right-6 bottom-6 z-30 hidden md:block">
        <Minimap />
      </div>

      {/* All visited CTA */}
      {allVisited && !activeNPC && (
        <div className="fixed inset-x-0 bottom-8 z-30 flex justify-center">
          <a
            href="#features"
            className="animate-bounce rounded-lg bg-[#4ECDC4] px-6 py-3 font-bold text-black shadow-lg shadow-[#4ECDC4]/30 transition hover:bg-[#45B7D1]"
          >
            Get Started with Agent Space →
          </a>
        </div>
      )}
    </>
  );
}
