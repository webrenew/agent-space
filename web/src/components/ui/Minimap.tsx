"use client";

import { useGameStore } from "@/stores/useGameStore";
import { npcs } from "@/data/npcs";

const SCALE = 6; // world units to pixels
const MAP_W = 130;
const MAP_H = 100;
const OFFSET_X = MAP_W / 2;
const OFFSET_Z = MAP_H / 2 - 15;

function worldToMap(
  x: number,
  z: number
): { left: number; top: number } {
  return {
    left: x * SCALE + OFFSET_X,
    top: -z * SCALE + OFFSET_Z,
  };
}

export function Minimap() {
  const playerPosition = useGameStore((s) => s.playerPosition);
  const visitedNPCs = useGameStore((s) => s.visitedNPCs);

  const player = worldToMap(playerPosition[0], playerPosition[2]);

  return (
    <div className="relative h-[100px] w-[130px] overflow-hidden rounded-lg border border-white/20 bg-black/60 backdrop-blur-sm">
      {/* Office outline */}
      <div
        className="absolute border border-white/10"
        style={{
          left: worldToMap(-11, 4).left,
          top: worldToMap(0, 4).top,
          width: 22 * SCALE,
          height: 18 * SCALE,
        }}
      />

      {/* NPC dots */}
      {npcs.map((npc) => {
        const pos = worldToMap(npc.position[0], npc.position[2]);
        const visited = visitedNPCs.has(npc.id);
        return (
          <div
            key={npc.id}
            className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/30 ${
              visited ? "opacity-50" : "animate-pulse"
            }`}
            style={{
              left: pos.left,
              top: pos.top,
              backgroundColor: npc.color,
            }}
            title={npc.name}
          >
            {visited && (
              <span className="absolute -top-0.5 -right-0.5 text-[6px] text-white">
                ✓
              </span>
            )}
          </div>
        );
      })}

      {/* Player dot */}
      <div
        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#6366F1]"
        style={{
          left: player.left,
          top: player.top,
        }}
      />
    </div>
  );
}
