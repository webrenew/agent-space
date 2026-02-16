import { useEffect } from "react";
import {
  resolveWorldTierConfig,
  type WorldTierEntityCaps,
  type WorldUnlockFlags,
} from "@/lib/world-tier-config";
import { useDemoStore } from "@/stores/useDemoStore";

const BASE_WORLD_TIER = resolveWorldTierConfig(0);
const BASE_WORLD_UNLOCKS = BASE_WORLD_TIER.unlocks;
const BASE_WORLD_CAPS = BASE_WORLD_TIER.caps;
const POLL_INTERVAL_MS = 60_000;

interface WorldStateTierSnapshot {
  unlocks?: {
    agentsAndDesks?: boolean;
    officeDetail?: boolean;
    exteriorPark?: boolean;
    blueSky?: boolean;
    worldRichness?: boolean;
  };
  caps?: {
    maxAgents?: number;
    maxDesks?: number;
    maxOfficeProps?: number;
    maxOfficePlants?: number;
    maxExteriorProps?: number;
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

function resolveSceneUnlocks(snapshot: WorldStateTierSnapshot): WorldUnlockFlags {
  return {
    agentsAndDesks: snapshot.unlocks?.agentsAndDesks === true,
    officeDetail: snapshot.unlocks?.officeDetail === true,
    exteriorPark: snapshot.unlocks?.exteriorPark === true,
    blueSky: snapshot.unlocks?.blueSky === true,
    worldRichness: snapshot.unlocks?.worldRichness === true,
  };
}

function resolveSceneCaps(snapshot: WorldStateTierSnapshot): WorldTierEntityCaps {
  const maxAgents = Number(snapshot.caps?.maxAgents);
  const maxDesks = Number(snapshot.caps?.maxDesks);
  const maxOfficeProps = Number(snapshot.caps?.maxOfficeProps);
  const maxOfficePlants = Number(snapshot.caps?.maxOfficePlants);
  const maxExteriorProps = Number(snapshot.caps?.maxExteriorProps);

  if (
    !Number.isFinite(maxAgents) ||
    !Number.isFinite(maxDesks) ||
    !Number.isFinite(maxOfficeProps) ||
    !Number.isFinite(maxOfficePlants) ||
    !Number.isFinite(maxExteriorProps)
  ) {
    return { ...BASE_WORLD_CAPS };
  }

  return {
    maxAgents: Math.floor(Math.max(BASE_WORLD_CAPS.maxAgents, maxAgents)),
    maxDesks: Math.floor(Math.max(BASE_WORLD_CAPS.maxDesks, maxDesks)),
    maxOfficeProps: Math.floor(Math.max(BASE_WORLD_CAPS.maxOfficeProps, maxOfficeProps)),
    maxOfficePlants: Math.floor(Math.max(BASE_WORLD_CAPS.maxOfficePlants, maxOfficePlants)),
    maxExteriorProps: Math.floor(Math.max(BASE_WORLD_CAPS.maxExteriorProps, maxExteriorProps)),
  };
}

export function useWorldStateSceneTier() {
  const setVisibleAgentCap = useDemoStore((s) => s.setVisibleAgentCap);
  const setSceneTierState = useDemoStore((s) => s.setSceneTierState);

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
        setSceneTierState(resolveSceneUnlocks(payload), resolveSceneCaps(payload));
        setVisibleAgentCap(resolveVisibleAgentCap(payload));
      } catch {
        // Keep the current view state if fetch fails.
        if (!cancelled) {
          setSceneTierState({ ...BASE_WORLD_UNLOCKS }, { ...BASE_WORLD_CAPS });
          setVisibleAgentCap(BASE_WORLD_CAPS.maxAgents);
        }
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
  }, [setSceneTierState, setVisibleAgentCap]);
}
