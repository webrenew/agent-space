import { useEffect } from "react";
import { resolveWorldTierConfig } from "@/lib/world-tier-config";
import { useDemoStore } from "@/stores/useDemoStore";

const BASE_WORLD_CAPS = resolveWorldTierConfig(0).caps;
const POLL_INTERVAL_MS = 60_000;

interface WorldStateTierSnapshot {
  unlocks?: {
    agentsAndDesks?: boolean;
  };
  caps?: {
    maxAgents?: number;
    maxDesks?: number;
  };
}

function resolveVisibleAgentCap(snapshot: WorldStateTierSnapshot): number {
  const unlocksAgentsAndDesks = snapshot.unlocks?.agentsAndDesks === true;
  if (!unlocksAgentsAndDesks) return BASE_WORLD_CAPS.maxAgents;

  const maxAgents = Number(snapshot.caps?.maxAgents);
  const maxDesks = Number(snapshot.caps?.maxDesks);
  if (!Number.isFinite(maxAgents) || !Number.isFinite(maxDesks)) {
    return BASE_WORLD_CAPS.maxAgents;
  }

  return Math.max(
    BASE_WORLD_CAPS.maxAgents,
    Math.floor(Math.min(maxAgents, maxDesks))
  );
}

export function useWorldStateSceneTier() {
  const setVisibleAgentCap = useDemoStore((s) => s.setVisibleAgentCap);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch("/api/world-state", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) return;

        const payload = (await response.json()) as WorldStateTierSnapshot;
        if (cancelled) return;
        setVisibleAgentCap(resolveVisibleAgentCap(payload));
      } catch {
        // Keep the current view state if fetch fails.
      }
    };

    void sync();
    const intervalId = setInterval(() => {
      void sync();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [setVisibleAgentCap]);
}
