import { getPrototypeInstallCountSnapshot } from "@/lib/install-count";
import {
  buildWorldStatePayload,
  resolveWorldInstallSignal,
  type WorldInstallSourceKind,
  type WorldStatePayload,
} from "@/lib/world-state-core";

const WORLD_INSTALL_SOURCE_ENV = "AGENT_OBSERVER_WORLD_INSTALL_SOURCE";
const WORLD_INSTALL_COUNT_ENV = "AGENT_OBSERVER_WORLD_INSTALL_COUNT";

function resolvePreferredSource(raw: string | undefined): WorldInstallSourceKind {
  return raw?.trim().toLowerCase() === "production" ? "production" : "prototype";
}

function parseProductionInstallCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export async function getWorldStatePayload(): Promise<WorldStatePayload> {
  const prototypeSnapshot = await getPrototypeInstallCountSnapshot();
  const signal = resolveWorldInstallSignal(prototypeSnapshot, {
    preferredSource: resolvePreferredSource(process.env[WORLD_INSTALL_SOURCE_ENV]),
    productionInstallCount: parseProductionInstallCount(process.env[WORLD_INSTALL_COUNT_ENV]),
    checkedAt: new Date().toISOString(),
  });

  return buildWorldStatePayload(signal);
}

export type { WorldStatePayload } from "@/lib/world-state-core";
