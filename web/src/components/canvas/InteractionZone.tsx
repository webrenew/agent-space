"use client";

import { useGameStore } from "@/stores/useGameStore";
import { npcs } from "@/data/npcs";
import { useProximity } from "@/hooks/useProximity";
import { useEffect, useRef } from "react";

export function InteractionZone() {
  const playerPosition = useGameStore((s) => s.playerPosition);
  const activeNPC = useGameStore((s) => s.activeNPC);
  const openDialog = useGameStore((s) => s.openDialog);
  const nearbyNPCs = useProximity(playerPosition, 3);
  const prevNearby = useRef<string[]>([]);

  // Auto-trigger dialog hint — could be extended for mobile tap-to-walk
  useEffect(() => {
    // Track nearby changes for potential future auto-interaction
    prevNearby.current = nearbyNPCs;
  }, [nearbyNPCs]);

  // E key to interact with nearest NPC
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "KeyE" && !activeNPC && nearbyNPCs.length > 0) {
        openDialog(nearbyNPCs[0]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nearbyNPCs, activeNPC, openDialog]);

  return null;
}
