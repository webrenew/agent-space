"use client";

import { useMemo } from "react";
import { npcs } from "@/data/npcs";

export function useProximity(
  playerPos: [number, number, number],
  threshold = 3
) {
  return useMemo(() => {
    const nearby: string[] = [];
    for (const npc of npcs) {
      const dx = playerPos[0] - npc.position[0];
      const dz = playerPos[2] - npc.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < threshold) {
        nearby.push(npc.id);
      }
    }
    return nearby;
  }, [playerPos, threshold]);
}
