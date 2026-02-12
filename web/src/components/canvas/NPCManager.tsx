"use client";

import { npcs } from "@/data/npcs";
import { useGameStore } from "@/stores/useGameStore";
import { NPC } from "./NPC";

export function NPCManager() {
  const playerPosition = useGameStore((s) => s.playerPosition);

  return (
    <>
      {npcs.map((npc) => (
        <NPC key={npc.id} config={npc} playerPosition={playerPosition} />
      ))}
    </>
  );
}
